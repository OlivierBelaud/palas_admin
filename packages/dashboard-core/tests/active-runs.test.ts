// AR — Unit tests for the sessionStorage-backed activeRuns registry.
// Follows the repo convention (see workflow-status.test.tsx): no jsdom,
// we install a minimal sessionStorage + window shim on globalThis.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveRun } from '../src/workflow/active-runs'
import * as activeRuns from '../src/workflow/active-runs'

// ── Minimal sessionStorage shim ───────────────────────────
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v)
  }
  removeItem(k: string): void {
    this.store.delete(k)
  }
  clear(): void {
    this.store.clear()
  }
}

const memory = new MemoryStorage()

// Install a window + sessionStorage shim so the `typeof window !== 'undefined'`
// guards in active-runs flip to the active branch during these tests.
;(globalThis as unknown as { window: unknown }).window = {
  sessionStorage: memory,
}

function sample(runId: string, overrides: Partial<ActiveRun> = {}): ActiveRun {
  return {
    runId,
    commandName: 'test-command',
    originPath: '/admin/test',
    detailPath: `/_runs/${runId}`,
    startedAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('AR — active-runs', () => {
  beforeEach(() => {
    memory.clear()
  })

  it('AR-01: list() returns [] when key absent', () => {
    expect(activeRuns.list()).toEqual([])
  })

  it('AR-02: add() then list() returns entry', () => {
    const r = sample('run-1')
    activeRuns.add(r)
    expect(activeRuns.list()).toEqual([r])
  })

  it('AR-03: add() with existing runId dedupes', () => {
    const r = sample('run-1')
    activeRuns.add(r)
    activeRuns.add(sample('run-1', { commandName: 'other' }))
    const l = activeRuns.list()
    expect(l).toHaveLength(1)
    expect(l[0].commandName).toBe('test-command')
  })

  it('AR-04: remove() removes entry', () => {
    activeRuns.add(sample('run-1'))
    activeRuns.add(sample('run-2'))
    activeRuns.remove('run-1')
    const l = activeRuns.list()
    expect(l).toHaveLength(1)
    expect(l[0].runId).toBe('run-2')
  })

  it('AR-05: has() returns true/false', () => {
    expect(activeRuns.has('run-x')).toBe(false)
    activeRuns.add(sample('run-x'))
    expect(activeRuns.has('run-x')).toBe(true)
  })

  it('AR-06: subscribe() fires on add+remove; unsubscribe stops', () => {
    const fn = vi.fn()
    const unsub = activeRuns.subscribe(fn)
    activeRuns.add(sample('run-1'))
    activeRuns.remove('run-1')
    expect(fn).toHaveBeenCalledTimes(2)
    unsub()
    activeRuns.add(sample('run-2'))
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('AR-07: corrupt JSON → list() returns [] without throw', () => {
    memory.setItem('manta.activeRuns', '{not json')
    expect(() => activeRuns.list()).not.toThrow()
    expect(activeRuns.list()).toEqual([])
  })
})
