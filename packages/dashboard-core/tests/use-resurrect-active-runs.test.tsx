// URA — Unit tests for resurrectForPath (the pure core of useResurrectActiveRuns).
// No DOM mount — mocks `@manta/ui` and tests the pathname-match logic directly.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@manta/ui', () => ({
  toast: {
    custom: vi.fn(),
    dismiss: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
  Button: () => null,
}))

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
;(globalThis as unknown as { window: unknown }).window = { sessionStorage: memory }

import { toast } from '@manta/ui'
import type { ActiveRun } from '../src/workflow/active-runs'
import * as activeRuns from '../src/workflow/active-runs'
import { resurrectForPath } from '../src/workflow/use-resurrect-active-runs'

function sample(runId: string, originPath: string, overrides: Partial<ActiveRun> = {}): ActiveRun {
  return {
    runId,
    commandName: 'cmd',
    originPath,
    detailPath: `/_runs/${runId}`,
    startedAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('URA — resurrectForPath', () => {
  beforeEach(() => {
    memory.clear()
    vi.clearAllMocks()
  })

  it('URA-01: matching originPath re-emits toast.custom with same id', () => {
    activeRuns.add(sample('r1', '/admin/products'))
    resurrectForPath('/admin/products')
    expect(toast.custom).toHaveBeenCalledTimes(1)
    const opts = (toast.custom as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as { id: string }
    expect(opts.id).toBe('workflow-run-r1')
  })

  it('URA-02: non-matching pathname does NOT re-emit', () => {
    activeRuns.add(sample('r1', '/admin/products'))
    resurrectForPath('/admin/orders')
    expect(toast.custom).not.toHaveBeenCalled()
  })

  it('URA-03: empty activeRuns → no calls', () => {
    resurrectForPath('/admin/products')
    expect(toast.custom).not.toHaveBeenCalled()
  })

  it('URA-04: multiple runs — only matching pathname re-emitted', () => {
    activeRuns.add(sample('r1', '/admin/products'))
    activeRuns.add(sample('r2', '/admin/orders'))
    activeRuns.add(sample('r3', '/admin/products'))
    resurrectForPath('/admin/products')
    expect(toast.custom).toHaveBeenCalledTimes(2)
    const ids = (toast.custom as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => (c[1] as { id: string }).id,
    )
    expect(ids).toEqual(['workflow-run-r1', 'workflow-run-r3'])
  })
})
