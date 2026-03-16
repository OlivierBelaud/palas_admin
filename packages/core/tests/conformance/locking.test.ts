import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  type ILockingPort,
  MantaError,
  createTestContainer,
  resetAll,
  InMemoryContainer,
} from '@manta/test-utils'

describe('ILockingPort Conformance', () => {
  let locking: ILockingPort
  let container: InMemoryContainer

  beforeEach(() => {
    container = createTestContainer()
    locking = container.resolve<ILockingPort>('ILockingPort')
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // L-01 — SPEC-066: execute provides mutual exclusion
  it('execute > exclusion mutuelle', async () => {
    const order: number[] = []

    const job1 = locking.execute(['lock-1'], async () => {
      order.push(1)
      await new Promise((r) => setTimeout(r, 50))
      order.push(2)
      return 'a'
    })

    const job2 = locking.execute(['lock-1'], async () => {
      order.push(3)
      await new Promise((r) => setTimeout(r, 50))
      order.push(4)
      return 'b'
    })

    await Promise.all([job1, job2])

    // Executions must be serialized: either [1,2,3,4] or [3,4,1,2]
    expect(
      (order[0] === 1 && order[1] === 2 && order[2] === 3 && order[3] === 4) ||
      (order[0] === 3 && order[1] === 4 && order[2] === 1 && order[3] === 2),
    ).toBe(true)
  })

  // L-02 — SPEC-066: execute returns job result
  it('execute > résultat retourné', async () => {
    const result = await locking.execute(['lock-1'], async () => 42)
    expect(result).toBe(42)
  })

  // L-03 — SPEC-066: execute propagates error and releases lock
  it('execute > erreur propagée', async () => {
    await expect(
      locking.execute(['lock-1'], async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    // Lock should be released — another acquire should succeed
    const acquired = await locking.acquire('lock-1')
    expect(acquired).toBe(true)
    await locking.release('lock-1')
  })

  // L-04 — SPEC-066: acquire/release manual lifecycle
  it('acquire/release > lifecycle manuel', async () => {
    // First acquire succeeds
    const first = await locking.acquire('lock-1')
    expect(first).toBe(true)

    // Second acquire fails (already locked)
    const second = await locking.acquire('lock-1')
    expect(second).toBe(false)

    // Release the lock
    await locking.release('lock-1')

    // Now acquire should succeed again
    const third = await locking.acquire('lock-1')
    expect(third).toBe(true)
    await locking.release('lock-1')
  })

  // L-05 — SPEC-066: TTL auto-expiration
  it('TTL > expiration auto', async () => {
    vi.useFakeTimers()

    await locking.acquire('lock-1', { expire: 1000 })

    // Before expiration — lock is held
    const beforeExpire = await locking.acquire('lock-1')
    expect(beforeExpire).toBe(false)

    // After expiration
    vi.advanceTimersByTime(1100)
    const afterExpire = await locking.acquire('lock-1')
    expect(afterExpire).toBe(true)

    await locking.release('lock-1')
    vi.useRealTimers()
  })

  // L-06 — SPEC-066: multi-key atomic rollback
  it('multi-key > atomicité', async () => {
    // Pre-lock key-2
    await locking.acquire('key-2')

    // Try to acquire both key-1 and key-2 — should fail atomically
    const result = await locking.acquire(['key-1', 'key-2'])
    expect(result).toBe(false)

    // key-1 should NOT be locked (atomic rollback)
    const key1Available = await locking.acquire('key-1')
    expect(key1Available).toBe(true)

    await locking.release('key-1')
    await locking.release('key-2')
  })

  // L-07 — SPEC-066: execute with timeout throws on slow job
  it('execute > timeout', async () => {
    // First, acquire the lock so the second execute must wait
    await locking.acquire('lock-1')

    // execute should timeout waiting to acquire
    const promise = locking.execute(['lock-1'], async () => {
      return 'should not reach'
    }, { timeout: 100 })

    await expect(promise).rejects.toThrow()

    await locking.release('lock-1')
  })
})
