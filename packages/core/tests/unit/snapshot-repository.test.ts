// Snapshot Repository tests — verifies auto-compensation wrapper and upsertWithReplace passthrough.
// Tests use direct imports to avoid the barrel export issue with require('./nullable').

import { beforeEach, describe, expect, it } from 'vitest'
import type { TypedRepository } from '../../src/service/define'
import { SnapshotRepository } from '../../src/service/snapshot-repository'

// Minimal mock repository implementing TypedRepository<T>
function createMockRepo<T extends Record<string, unknown>>(): TypedRepository<T> & {
  _calls: Array<{ method: string; args: unknown[] }>
} {
  const calls: Array<{ method: string; args: unknown[] }> = []
  return {
    _calls: calls,
    async find(options) {
      calls.push({ method: 'find', args: [options] })
      // Return a fake entity for snapshot lookups
      if (options?.where && (options.where as Record<string, unknown>).id) {
        return [{ id: (options.where as Record<string, unknown>).id, name: 'existing' } as unknown as T]
      }
      return []
    },
    async findAndCount(options) {
      calls.push({ method: 'findAndCount', args: [options] })
      return [[], 0]
    },
    async create(data) {
      calls.push({ method: 'create', args: [data] })
      if (Array.isArray(data)) {
        return data.map((d, i) => ({ ...d, id: `gen_${i}` })) as unknown as T[]
      }
      return { ...data, id: 'gen_0' } as unknown as T
    },
    async update(data) {
      calls.push({ method: 'update', args: [data] })
      return { ...data } as unknown as T
    },
    async delete(ids) {
      calls.push({ method: 'delete', args: [ids] })
    },
    async softDelete(ids) {
      calls.push({ method: 'softDelete', args: [ids] })
      return {}
    },
    async restore(ids) {
      calls.push({ method: 'restore', args: [ids] })
    },
    async upsertWithReplace(data, replaceFields, conflictTarget) {
      calls.push({ method: 'upsertWithReplace', args: [data, replaceFields, conflictTarget] })
      return data as T[]
    },
  }
}

describe('SnapshotRepository', () => {
  let inner: ReturnType<typeof createMockRepo>
  let repo: SnapshotRepository<Record<string, unknown>>

  beforeEach(() => {
    inner = createMockRepo()
    repo = new SnapshotRepository(inner)
  })

  // SR-01 — find is a passthrough (no snapshot)
  it('SR-01: find delegates to inner repo without snapshotting', async () => {
    await repo.find({ where: { status: 'active' } })
    expect(inner._calls).toHaveLength(1)
    expect(inner._calls[0].method).toBe('find')
    expect(repo.hasSnapshots).toBe(false)
  })

  // SR-02 — findAndCount is a passthrough (no snapshot)
  it('SR-02: findAndCount delegates to inner repo without snapshotting', async () => {
    await repo.findAndCount({ where: { status: 'active' } })
    expect(inner._calls).toHaveLength(1)
    expect(inner._calls[0].method).toBe('findAndCount')
    expect(repo.hasSnapshots).toBe(false)
  })

  // SR-03 — create snapshots created IDs for rollback
  it('SR-03: create snapshots created IDs', async () => {
    const result = await repo.create({ name: 'test' })
    expect(repo.hasSnapshots).toBe(true)
    expect((result as Record<string, unknown>).id).toBe('gen_0')
  })

  // SR-04 — update snapshots entity state before mutation
  it('SR-04: update fetches entity before mutation and snapshots it', async () => {
    await repo.update({ id: 'x', name: 'new' })
    // Should have called find (for snapshot) then update
    expect(inner._calls[0].method).toBe('find')
    expect(inner._calls[1].method).toBe('update')
    expect(repo.hasSnapshots).toBe(true)
  })

  // SR-05 — delete snapshots entity state before removal
  it('SR-05: delete fetches entity before removal and snapshots it', async () => {
    await repo.delete('x')
    expect(inner._calls[0].method).toBe('find')
    expect(inner._calls[1].method).toBe('delete')
    expect(repo.hasSnapshots).toBe(true)
  })

  // SR-06 — softDelete snapshots entity state
  it('SR-06: softDelete fetches entity before soft-deletion and snapshots it', async () => {
    await repo.softDelete('x')
    expect(inner._calls[0].method).toBe('find')
    expect(inner._calls[1].method).toBe('softDelete')
    expect(repo.hasSnapshots).toBe(true)
  })

  // SR-07 — restore is a passthrough (no snapshot)
  it('SR-07: restore delegates without snapshotting', async () => {
    await repo.restore('x')
    expect(inner._calls).toHaveLength(1)
    expect(inner._calls[0].method).toBe('restore')
    expect(repo.hasSnapshots).toBe(false)
  })

  // SR-08 — upsertWithReplace passes through without compensation
  it('SR-08: upsertWithReplace delegates to inner repo without snapshotting', async () => {
    const data = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]
    const result = await repo.upsertWithReplace(data, ['name'], ['id'])
    expect(inner._calls).toHaveLength(1)
    expect(inner._calls[0].method).toBe('upsertWithReplace')
    expect(inner._calls[0].args).toEqual([data, ['name'], ['id']])
    expect(result).toHaveLength(2)
    expect(repo.hasSnapshots).toBe(false)
  })

  // SR-09 — upsertWithReplace works with no optional params
  it('SR-09: upsertWithReplace works without replaceFields and conflictTarget', async () => {
    const data = [{ id: 'c', name: 'C' }]
    await repo.upsertWithReplace(data)
    expect(inner._calls[0].args).toEqual([data, undefined, undefined])
  })

  // SR-10 — rollback reverses create (deletes created entity)
  it('SR-10: rollback after create deletes the created entity', async () => {
    await repo.create({ name: 'test' })
    await repo.rollback()

    const deleteCalls = inner._calls.filter((c) => c.method === 'delete')
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0].args[0]).toBe('gen_0')
    expect(repo.hasSnapshots).toBe(false)
  })

  // SR-11 — rollback reverses update (restores original state)
  it('SR-11: rollback after update restores original entity state', async () => {
    await repo.update({ id: 'x', name: 'new' })
    await repo.rollback()

    const updateCalls = inner._calls.filter((c) => c.method === 'update')
    // First update = the actual mutation, second update = rollback restoring original
    expect(updateCalls).toHaveLength(2)
    expect(updateCalls[1].args[0]).toEqual({ id: 'x', name: 'existing' })
  })

  // SR-12 — rollback reverses delete (re-creates deleted entity)
  it('SR-12: rollback after delete re-creates the deleted entity', async () => {
    await repo.delete('x')
    await repo.rollback()

    const createCalls = inner._calls.filter((c) => c.method === 'create')
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0].args[0]).toEqual({ id: 'x', name: 'existing' })
  })

  // SR-13 — rollback reverses softDelete (restores entity)
  it('SR-13: rollback after softDelete restores the entity', async () => {
    await repo.softDelete('x')
    await repo.rollback()

    const restoreCalls = inner._calls.filter((c) => c.method === 'restore')
    expect(restoreCalls).toHaveLength(1)
    expect(restoreCalls[0].args[0]).toBe('x')
  })

  // SR-14 — clearSnapshots resets state
  it('SR-14: clearSnapshots resets snapshot tracking', async () => {
    await repo.create({ name: 'test' })
    expect(repo.hasSnapshots).toBe(true)
    repo.clearSnapshots()
    expect(repo.hasSnapshots).toBe(false)
  })

  // SR-15 — rollback processes mutations in reverse order
  it('SR-15: rollback processes mutations in reverse order', async () => {
    await repo.create({ name: 'first' })
    await repo.update({ id: 'y', name: 'second' })
    await repo.delete('z')

    const preRollbackCount = inner._calls.length
    await repo.rollback()

    // Rollback should process: delete-z (re-create), update-y (restore), create-first (delete)
    // In reverse: delete snapshot -> create, update snapshot -> update, create snapshot -> delete
    const rollbackCalls = inner._calls.slice(preRollbackCount)
    expect(rollbackCalls[0].method).toBe('create') // undo delete
    expect(rollbackCalls[1].method).toBe('update') // undo update
    expect(rollbackCalls[2].method).toBe('delete') // undo create
  })
})
