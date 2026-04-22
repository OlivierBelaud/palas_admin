// TWR — Unit tests for toastWorkflowRun.
// No DOM mount — mocks `@manta/ui` to observe calls.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @manta/ui so we can observe toast.custom calls without rendering.
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

// Minimal sessionStorage + window shim
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
;(globalThis as unknown as { window: unknown }).window = {
  sessionStorage: memory,
  location: { pathname: '/admin/products' },
}

// Import AFTER mocks + window shim
import { toast } from '@manta/ui'
import * as activeRuns from '../src/workflow/active-runs'
import { toastWorkflowRun } from '../src/workflow/toast-workflow-run'

describe('TWR — toastWorkflowRun', () => {
  beforeEach(() => {
    memory.clear()
    vi.clearAllMocks()
  })

  it('TWR-01: calls toast.custom with id workflow-run-<runId> and duration Infinity', () => {
    toastWorkflowRun('run-abc', { commandName: 'import-products' })
    expect(toast.custom).toHaveBeenCalledTimes(1)
    const call = (toast.custom as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    const opts = call[1] as { id: string; duration: number; dismissible: boolean }
    expect(opts.id).toBe('workflow-run-run-abc')
    expect(opts.duration).toBe(Number.POSITIVE_INFINITY)
    expect(opts.dismissible).toBe(false)
  })

  it('TWR-02: registers in activeRuns with originPath = window.location.pathname', () => {
    toastWorkflowRun('run-1', { commandName: 'cmd' })
    const l = activeRuns.list()
    expect(l).toHaveLength(1)
    expect(l[0].originPath).toBe('/admin/products')
    // detailPath now derives the SPA basename from originPath so the toast's
    // 'Voir les détails' navigates inside the admin shell instead of hitting
    // a 404 at root (`/_runs/:id` was the old buggy behaviour).
    expect(l[0].detailPath).toBe('/admin/_runs/run-1')
  })

  it('TWR-03: passes commandName + commandLabel through', () => {
    toastWorkflowRun('run-2', { commandName: 'import-products', commandLabel: 'Importer' })
    const l = activeRuns.list()
    expect(l[0].commandName).toBe('import-products')
    expect(l[0].commandLabel).toBe('Importer')
  })

  it('TWR-04: uses custom originPath when provided', () => {
    toastWorkflowRun('run-3', { commandName: 'cmd', originPath: '/admin/custom' })
    const l = activeRuns.list()
    expect(l[0].originPath).toBe('/admin/custom')
  })

  it('TWR-05: idempotent — second call with same runId does not re-add or re-toast', () => {
    toastWorkflowRun('run-4', { commandName: 'cmd' })
    toastWorkflowRun('run-4', { commandName: 'cmd' })
    expect(activeRuns.list()).toHaveLength(1)
    expect(toast.custom).toHaveBeenCalledTimes(1)
  })
})
