// Section F — Bootstrap sequence
// Tests: F-01 → F-12

import { describe, it, expect } from 'vitest'
import { boot, lazyBoot } from '../src/bootstrap/boot'
import type { BootContext } from '../src/types'

function makeContext(overrides: Partial<BootContext> = {}): BootContext {
  return {
    config: {
      database: { url: 'postgresql://localhost:5432/test' },
      featureFlags: {},
    },
    profile: 'dev',
    ...overrides,
  }
}

describe('F — Bootstrap sequence', () => {
  // -------------------------------------------------------------------
  // F-01 → F-04 — Core boot (steps 1-8)
  // -------------------------------------------------------------------
  it('F-01 — core boot completes 8 steps with valid config', async () => {
    const ctx = makeContext()
    const result = await boot(ctx)
    expect(result.success).toBe(true)
    expect(result.stepsCompleted).toBe(8)
    expect(result.errors).toHaveLength(0)
  })

  it('F-02 — core boot fails on unknown feature flag', async () => {
    const ctx = makeContext({
      config: {
        database: { url: 'postgresql://localhost/test' },
        featureFlags: { unknownFlag: true },
      },
    })
    const result = await boot(ctx)
    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]!.step).toBe(2)
    expect(result.errors[0]!.fatal).toBe(true)
    expect(result.errors[0]!.message).toContain('Unknown feature flag')
  })

  it('F-03 — core boot records timings for each step', async () => {
    const ctx = makeContext()
    const result = await boot(ctx)
    expect(Object.keys(result.timings).length).toBe(8)
    for (let i = 1; i <= 8; i++) {
      expect(result.timings[i]).toBeDefined()
      expect(result.timings[i]).toBeGreaterThanOrEqual(0)
    }
  })

  it('F-04 — core boot accepts known feature flags', async () => {
    const ctx = makeContext({
      config: {
        database: { url: 'postgresql://localhost/test' },
        featureFlags: { rbac: true, translation: false },
      },
    })
    const result = await boot(ctx)
    expect(result.success).toBe(true)
  })

  // -------------------------------------------------------------------
  // F-05 → F-08 — Lazy boot (steps 9-18)
  // -------------------------------------------------------------------
  it('F-05 — lazy boot completes steps 9-18', async () => {
    const ctx = makeContext()
    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
    expect(result.stepsCompleted).toBe(18)
  })

  it('F-06 — lazy boot records timings for steps 9-18', async () => {
    const ctx = makeContext()
    const result = await lazyBoot(ctx)
    for (let i = 9; i <= 18; i++) {
      expect(result.timings[i]).toBeGreaterThanOrEqual(0)
    }
  })

  it('F-07 — lazy boot skips RBAC if flag is off', async () => {
    const ctx = makeContext({
      config: {
        database: { url: 'postgresql://localhost/test' },
        featureFlags: { rbac: false },
      },
    })
    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
    // Step 14 (RBAC) should complete without error
    expect(result.errors.filter((e) => e.step === 14)).toHaveLength(0)
  })

  it('F-08 — lazy boot skips translation if flag is off', async () => {
    const ctx = makeContext({
      config: {
        database: { url: 'postgresql://localhost/test' },
        featureFlags: { translation: false },
      },
    })
    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
  })

  // -------------------------------------------------------------------
  // F-09 → F-12 — Error handling
  // -------------------------------------------------------------------
  it('F-09 — boot result has success=false when a fatal step fails', async () => {
    const ctx = makeContext({
      config: {
        database: { url: 'postgresql://localhost/test' },
        featureFlags: { badFlag: true },
      },
    })
    const result = await boot(ctx)
    expect(result.success).toBe(false)
  })

  it('F-10 — boot stops at first fatal error (does not continue)', async () => {
    const ctx = makeContext({
      config: {
        database: { url: 'postgresql://localhost/test' },
        featureFlags: { badFlag: true },
      },
    })
    const result = await boot(ctx)
    // Should have stopped at step 2 (feature flags)
    expect(result.stepsCompleted).toBeLessThan(8)
  })

  it('F-11 — successful boot has correct field values', async () => {
    const ctx = makeContext()
    const result = await boot(ctx)
    expect(result.success).toBe(true)
    expect(result.stepsCompleted).toBe(8)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(Object.keys(result.timings)).toHaveLength(8)
  })

  it('F-12 — fatal errors include step number', async () => {
    const ctx = makeContext({
      config: {
        database: { url: 'postgresql://localhost/test' },
        featureFlags: { xyz: true },
      },
    })
    const result = await boot(ctx)
    expect(result.errors[0]!.step).toBe(2)
    expect(result.errors[0]!.fatal).toBe(true)
    expect(result.errors[0]!.message).toContain('Unknown feature flag')
  })
})
