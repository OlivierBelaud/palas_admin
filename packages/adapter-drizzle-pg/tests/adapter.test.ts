// SPEC-056 — DrizzlePgAdapter unit tests (no PG required)
// Tests: DA-01 → DA-10

import { describe, it, expect } from 'vitest'
import { DrizzlePgAdapter } from '../src/adapter'
import { MantaError } from '@manta/core'

describe('DrizzlePgAdapter — unit tests (no PG)', () => {
  it('DA-01 — getClient() throws INVALID_STATE before initialize()', () => {
    const adapter = new DrizzlePgAdapter()
    expect(() => adapter.getClient()).toThrow(MantaError)
    try {
      adapter.getClient()
    } catch (err) {
      expect((err as MantaError).type).toBe('INVALID_STATE')
      expect((err as MantaError).message).toContain('not initialized')
    }
  })

  it('DA-02 — getPool() throws INVALID_STATE before initialize()', () => {
    const adapter = new DrizzlePgAdapter()
    expect(() => adapter.getPool()).toThrow(MantaError)
    try {
      adapter.getPool()
    } catch (err) {
      expect((err as MantaError).type).toBe('INVALID_STATE')
    }
  })

  it('DA-03 — healthCheck() returns false before initialize()', async () => {
    const adapter = new DrizzlePgAdapter()
    const healthy = await adapter.healthCheck()
    expect(healthy).toBe(false)
  })

  it('DA-04 — dispose() before initialize() marks adapter as disposed', async () => {
    const adapter = new DrizzlePgAdapter()
    await adapter.dispose()
    // After dispose, adapter is in disposed state: healthCheck returns false
    const healthy = await adapter.healthCheck()
    expect(healthy).toBe(false)
    // And initialize() should reject with INVALID_STATE
    await expect(
      adapter.initialize({ url: 'postgresql://localhost/test' }),
    ).rejects.toThrow(MantaError)
  })

  it('DA-05 — dispose() marks adapter as disposed', async () => {
    const adapter = new DrizzlePgAdapter()
    await adapter.dispose()
    // After dispose, healthCheck returns false
    const healthy = await adapter.healthCheck()
    expect(healthy).toBe(false)
  })

  it('DA-06 — initialize() throws INVALID_STATE after dispose()', async () => {
    const adapter = new DrizzlePgAdapter()
    await adapter.dispose()
    await expect(
      adapter.initialize({ url: 'postgresql://localhost/test' }),
    ).rejects.toThrow(MantaError)
  })

  it('DA-07 — IDatabasePort methods behave correctly before initialization', async () => {
    const adapter = new DrizzlePgAdapter()
    // getClient throws INVALID_STATE
    expect(() => adapter.getClient()).toThrow(MantaError)
    // getPool throws INVALID_STATE
    expect(() => adapter.getPool()).toThrow(MantaError)
    // healthCheck returns false (not initialized)
    expect(await adapter.healthCheck()).toBe(false)
    // transaction rejects with INVALID_STATE (no client)
    await expect(adapter.transaction(async () => 'x')).rejects.toThrow(MantaError)
    // introspect rejects with INVALID_STATE (no pool)
    await expect(adapter.introspect()).rejects.toThrow(MantaError)
  })

  it('DA-08 — transaction() throws when not initialized', async () => {
    const adapter = new DrizzlePgAdapter()
    await expect(
      adapter.transaction(async () => 'result'),
    ).rejects.toThrow(MantaError)
  })

  it('DA-09 — transaction with all isolation levels rejects with INVALID_STATE (not initialized), not with invalid option errors', async () => {
    const adapter = new DrizzlePgAdapter()
    const validLevels = ['READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']
    for (const level of validLevels) {
      try {
        await adapter.transaction(async () => {}, { isolationLevel: level })
        // Should never reach here
        expect.unreachable('transaction should have thrown')
      } catch (err) {
        // All levels should fail with INVALID_STATE (not initialized), never with an invalid-option error
        expect(MantaError.is(err)).toBe(true)
        expect((err as MantaError).type).toBe('INVALID_STATE')
      }
    }
  })

  it('DA-10 — dispose() is idempotent (calling twice leaves adapter in same disposed state)', async () => {
    const adapter = new DrizzlePgAdapter()
    await adapter.dispose()
    // Second dispose should succeed without error
    await adapter.dispose()
    // State after double dispose is the same: healthCheck false, getClient throws
    const healthy = await adapter.healthCheck()
    expect(healthy).toBe(false)
    expect(() => adapter.getClient()).toThrow(MantaError)
  })
})
