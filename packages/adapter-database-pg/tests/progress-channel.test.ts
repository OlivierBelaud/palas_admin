// DbProgressChannel — unit tests using a fake Drizzle client.
// Verifies throttling, clear-cancels-pending, never-throws, and isolation
// between runIds. WORKFLOW_PROGRESS.md §9.2 / §10.2.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DbProgressChannel } from '../src/progress-channel'

// Minimal fake that records the shape of the calls DbProgressChannel makes.
// Mirrors the Drizzle chainable API: db.insert(table).values(...).onConflictDoUpdate({...}).
function createFakeDb(opts: { failInsert?: boolean } = {}) {
  const inserts: Array<{ values: unknown; updateSet: unknown }> = []
  const deletes: Array<unknown> = []

  const db = {
    insert(_table: unknown) {
      return {
        values(values: unknown) {
          return {
            async onConflictDoUpdate(arg: { target: unknown; set: unknown }) {
              if (opts.failInsert) throw new Error('DB down')
              inserts.push({ values, updateSet: arg.set })
            },
          }
        },
      }
    },
    delete(_table: unknown) {
      return {
        async where(condition: unknown) {
          deletes.push(condition)
        },
      }
    },
    select() {
      return {
        from(_table: unknown) {
          return {
            where(_condition: unknown) {
              return {
                async limit(_n: number) {
                  return []
                },
              }
            },
          }
        },
      }
    },
  }

  return { db, inserts, deletes }
}

describe('DbProgressChannel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // PC-DB-01 — set+get roundtrip: first set flushes immediately via onConflictDoUpdate.
  it('PC-DB-01 — first set flushes immediately (no throttle)', async () => {
    const { db, inserts } = createFakeDb()
    // biome-ignore lint/suspicious/noExplicitAny: injected fake
    const channel = new DbProgressChannel(db as any)

    await channel.set('run-a', { stepName: 'x', current: 1, total: 10, at: 100 })
    // Flush scheduled synchronously via `void this._flush(...)`. Yield the microtask queue.
    await Promise.resolve()

    expect(inserts).toHaveLength(1)
    const [row] = inserts
    expect(row.values).toMatchObject({
      run_id: 'run-a',
      step_name: 'x',
      current: 1,
      total: 10,
      message: null,
      at_ms: 100,
    })
  })

  // PC-DB-02 — two sets within the 500ms window coalesce into a single write.
  it('PC-DB-02 — throttle: two sets within 500ms → one write with the latest snapshot', async () => {
    const { db, inserts } = createFakeDb()
    // biome-ignore lint/suspicious/noExplicitAny: injected fake
    const channel = new DbProgressChannel(db as any)

    // First set flushes immediately.
    await channel.set('run-b', { stepName: 's', current: 1, total: 100, at: 1 })
    await Promise.resolve()
    expect(inserts).toHaveLength(1)

    // Second set arrives 100ms later — must be buffered.
    await vi.advanceTimersByTimeAsync(100)
    await channel.set('run-b', { stepName: 's', current: 2, total: 100, at: 2 })
    await Promise.resolve()
    expect(inserts).toHaveLength(1)

    // Third set 100ms later — still within window, replaces the buffered value.
    await vi.advanceTimersByTimeAsync(100)
    await channel.set('run-b', { stepName: 's', current: 3, total: 100, at: 3 })
    await Promise.resolve()
    expect(inserts).toHaveLength(1)

    // Advance past the throttle window — the scheduled flush fires with the latest snapshot.
    await vi.advanceTimersByTimeAsync(400)
    await Promise.resolve()

    expect(inserts).toHaveLength(2)
    expect(inserts[1].values).toMatchObject({ current: 3, at_ms: 3 })
  })

  // PC-DB-03 — clear cancels any pending scheduled flush.
  it('PC-DB-03 — clear cancels a pending flush and deletes the row', async () => {
    const { db, inserts, deletes } = createFakeDb()
    // biome-ignore lint/suspicious/noExplicitAny: injected fake
    const channel = new DbProgressChannel(db as any)

    // Prime the throttle: first set immediate, second schedules a flush.
    await channel.set('run-c', { stepName: 's', current: 1, total: 5, at: 1 })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(100)
    await channel.set('run-c', { stepName: 's', current: 2, total: 5, at: 2 })
    await Promise.resolve()
    expect(inserts).toHaveLength(1)

    // Clear — should cancel the pending timer and issue DELETE.
    await channel.clear('run-c')
    expect(deletes).toHaveLength(1)

    // Advance time past the would-be flush deadline — no extra write must land.
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.resolve()
    expect(inserts).toHaveLength(1)
  })

  // PC-DB-04 — set MUST NOT throw when the DB is down (invariant #2).
  it('PC-DB-04 — set never throws when the DB write fails', async () => {
    const { db } = createFakeDb({ failInsert: true })
    // biome-ignore lint/suspicious/noExplicitAny: injected fake
    const channel = new DbProgressChannel(db as any)

    // Immediate flush path — the internal promise rejects; public set() resolves.
    await expect(channel.set('run-d', { stepName: 's', current: 1, total: 1, at: 1 })).resolves.toBeUndefined()
    // Yield to let the fire-and-forget flush settle without an unhandled rejection.
    await Promise.resolve()
  })

  // PC-DB-05 — concurrent set to distinct runIds: each flushes independently.
  it('PC-DB-05 — concurrent set() on different runIds all flush immediately', async () => {
    const { db, inserts } = createFakeDb()
    // biome-ignore lint/suspicious/noExplicitAny: injected fake
    const channel = new DbProgressChannel(db as any)

    await Promise.all([
      channel.set('run-e1', { stepName: 's', current: 1, total: 1, at: 1 }),
      channel.set('run-e2', { stepName: 's', current: 1, total: 1, at: 1 }),
      channel.set('run-e3', { stepName: 's', current: 1, total: 1, at: 1 }),
    ])
    await Promise.resolve()

    expect(inserts).toHaveLength(3)
    const ids = inserts.map((i) => (i.values as { run_id: string }).run_id).sort()
    expect(ids).toEqual(['run-e1', 'run-e2', 'run-e3'])
  })
})
