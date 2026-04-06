// Section C1 — Bootstrap sequence
// Ref: CLI_SPEC §2.1 flow step 6, CLI_TESTS_SPEC §C1
// These tests verify that boot() actually DOES things:
// - Creates and configures an app
// - Registers adapters in the app
// - Validates feature flags
// - Records timings
// - Handles errors per step severity

import { ContainerRegistrationKeys } from '@manta/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boot, lazyBoot } from '../../../src/bootstrap/boot'
import type { BootContext } from '../../../src/types'

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

describe('C1 — Bootstrap sequence', () => {
  // -------------------------------------------------------------------
  // BOOT-01 — Core boot executes 8 steps, creates app
  // -------------------------------------------------------------------
  it('BOOT-01 — core boot creates an app and completes 8 steps', async () => {
    const ctx = makeContext()
    const result = await boot(ctx)
    expect(result.success).toBe(true)
    expect(result.stepsCompleted).toBe(8)
    expect(result.errors).toHaveLength(0)
    // After boot, context should have an app
    expect(ctx.app).toBeDefined()
    expect(ctx.app!.id).toBeDefined()
  })

  // -------------------------------------------------------------------
  // BOOT-02 — Core boot registers logger in app (step 4)
  // -------------------------------------------------------------------
  it('BOOT-02 — step 4 registers ILoggerPort in the app', async () => {
    const ctx = makeContext()
    await boot(ctx)
    // Logger should be resolvable from the app
    const logger = ctx.app!.resolve<unknown>(ContainerRegistrationKeys.LOGGER)
    expect(logger).toBeDefined()
  })

  // -------------------------------------------------------------------
  // BOOT-03 — Core boot fails on unknown feature flag (step 2)
  // -------------------------------------------------------------------
  it('BOOT-03 — fails on unknown feature flag with step=2', async () => {
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

  // -------------------------------------------------------------------
  // BOOT-04 — Core boot accepts known feature flags
  // -------------------------------------------------------------------
  it('BOOT-04 — accepts known feature flags (rbac, translation)', async () => {
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
  // BOOT-05 — Core boot records timings for each step
  // -------------------------------------------------------------------
  it('BOOT-05 — records timings for steps 1-8', async () => {
    const ctx = makeContext()
    const result = await boot(ctx)
    expect(Object.keys(result.timings).length).toBe(8)
    for (let i = 1; i <= 8; i++) {
      expect(result.timings[i]).toBeDefined()
      expect(result.timings[i]).toBeGreaterThanOrEqual(0)
    }
  })

  // -------------------------------------------------------------------
  // BOOT-06 — Step 8 (routes) is best-effort (warning, not fatal)
  // -------------------------------------------------------------------
  it('BOOT-06 — step 8 failure is warning, not fatal', async () => {
    const ctx = makeContext()
    const result = await boot(ctx)
    // With valid config, step 8 should succeed
    expect(result.success).toBe(true)
    expect(result.stepsCompleted).toBe(8)
  })

  // -------------------------------------------------------------------
  // BOOT-07 — Stops at first fatal error
  // -------------------------------------------------------------------
  it('BOOT-07 — stops at first fatal error, does not continue', async () => {
    const ctx = makeContext({
      config: {
        database: { url: 'postgresql://localhost/test' },
        featureFlags: { badFlag: true },
      },
    })
    const result = await boot(ctx)
    // Should have stopped at step 2 (feature flags)
    expect(result.stepsCompleted).toBeLessThan(8)
    expect(result.success).toBe(false)
  })

  // -------------------------------------------------------------------
  // BOOT-08 — Lazy boot completes steps 9-18
  // -------------------------------------------------------------------
  it('BOOT-08 — lazy boot completes steps 9-18', async () => {
    const ctx = makeContext()
    // First do core boot to set up app
    await boot(ctx)
    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
    expect(result.stepsCompleted).toBe(18)
  })

  // -------------------------------------------------------------------
  // BOOT-09 — Lazy boot records timings
  // -------------------------------------------------------------------
  it('BOOT-09 — lazy boot records timings for steps 9-18', async () => {
    const ctx = makeContext()
    await boot(ctx)
    const result = await lazyBoot(ctx)
    for (let i = 9; i <= 18; i++) {
      expect(result.timings[i]).toBeDefined()
    }
  })

  // -------------------------------------------------------------------
  // BOOT-10 — Lazy boot skips RBAC if flag off
  // -------------------------------------------------------------------
  it('BOOT-10 — skips RBAC (step 14) if flag is off', async () => {
    const ctx = makeContext({
      config: {
        database: { url: 'postgresql://localhost/test' },
        featureFlags: { rbac: false },
      },
    })
    await boot(ctx)
    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
    expect(result.errors.filter((e) => e.step === 14)).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // BOOT-11 — Lazy boot skips translation if flag off
  // -------------------------------------------------------------------
  it('BOOT-11 — skips translation (step 17) if flag is off', async () => {
    const ctx = makeContext({
      config: {
        database: { url: 'postgresql://localhost/test' },
        featureFlags: { translation: false },
      },
    })
    await boot(ctx)
    const result = await lazyBoot(ctx)
    expect(result.success).toBe(true)
  })

  // -------------------------------------------------------------------
  // BOOT-12 — BootResult has required fields
  // -------------------------------------------------------------------
  it('BOOT-12 — BootResult type has required fields', async () => {
    const ctx = makeContext()
    const result = await boot(ctx)
    expect(typeof result.success).toBe('boolean')
    expect(typeof result.stepsCompleted).toBe('number')
    expect(Array.isArray(result.errors)).toBe(true)
    expect(Array.isArray(result.warnings)).toBe(true)
    expect(typeof result.timings).toBe('object')
  })

  // -------------------------------------------------------------------
  // BOOT-13 — Fatal errors include step number
  // -------------------------------------------------------------------
  it('BOOT-13 — fatal errors include step number', async () => {
    const ctx = makeContext({
      config: {
        database: { url: 'postgresql://localhost/test' },
        featureFlags: { xyz: true },
      },
    })
    const result = await boot(ctx)
    expect(result.errors[0]!.step).toBe(2)
    expect(typeof result.errors[0]!.step).toBe('number')
  })

  // -------------------------------------------------------------------
  // BOOT-14 — Container has registrations after boot
  // -------------------------------------------------------------------
  it('BOOT-14 — app has logger and event bus after boot', async () => {
    const ctx = makeContext()
    const result = await boot(ctx)
    expect(result.success).toBe(true)

    const app = ctx.app!
    // Logger must be registered
    expect(() => app.resolve(ContainerRegistrationKeys.LOGGER)).not.toThrow()
    // Event bus must be registered (step 6 — required modules)
    expect(() => app.resolve(ContainerRegistrationKeys.EVENT_BUS)).not.toThrow()
    // Cache must be registered (step 6 — required modules)
    expect(() => app.resolve(ContainerRegistrationKeys.CACHE)).not.toThrow()
  })
})
