// NeonLockingAdapter — unit tests (rawSql mocked)
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NeonLockingAdapter } from '../src'
import { stringToAdvisoryLockKey } from '../src/hash'

describe('NeonLockingAdapter', () => {
  let adapter: NeonLockingAdapter
  let mockSql: ReturnType<typeof vi.fn>
  const lockedKeys = new Set<bigint>()

  beforeEach(() => {
    lockedKeys.clear()
    // Simulate PG advisory locks behavior
    mockSql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join('?')
      const lockKey = values[0] as bigint

      if (query.includes('pg_try_advisory_lock')) {
        if (lockedKeys.has(lockKey)) {
          return [{ acquired: false }]
        }
        lockedKeys.add(lockKey)
        return [{ acquired: true }]
      }

      if (query.includes('pg_advisory_unlock_all')) {
        lockedKeys.clear()
        return [{ pg_advisory_unlock_all: '' }]
      }

      if (query.includes('pg_advisory_unlock')) {
        lockedKeys.delete(lockKey)
        return [{ pg_advisory_unlock: true }]
      }

      return []
    })

    adapter = new NeonLockingAdapter(mockSql as any)
  })

  // L-04 — acquire/release lifecycle
  it('acquire/release > lifecycle', async () => {
    const first = await adapter.acquire('lock-1')
    expect(first).toBe(true)

    const second = await adapter.acquire('lock-1')
    expect(second).toBe(false)

    await adapter.release('lock-1')

    const third = await adapter.acquire('lock-1')
    expect(third).toBe(true)
    await adapter.release('lock-1')
  })

  // L-02 — execute returns job result
  it('execute > returns result', async () => {
    const result = await adapter.execute(['lock-1'], async () => 42)
    expect(result).toBe(42)
  })

  // L-03 — execute propagates error and releases lock
  it('execute > error propagation and lock release', async () => {
    await expect(
      adapter.execute(['lock-1'], async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    // Lock should be released
    const acquired = await adapter.acquire('lock-1')
    expect(acquired).toBe(true)
    await adapter.release('lock-1')
  })

  // L-06 — multi-key atomic rollback
  it('multi-key > atomic rollback', async () => {
    // Pre-lock key-2
    await adapter.acquire('key-2')

    // Try to acquire both key-1 and key-2 — should fail atomically
    const result = await adapter.acquire(['key-1', 'key-2'])
    expect(result).toBe(false)

    // key-1 should NOT be locked (atomic rollback)
    const key1Available = await adapter.acquire('key-1')
    expect(key1Available).toBe(true)

    await adapter.release('key-1')
    await adapter.release('key-2')
  })

  // releaseAll
  it('releaseAll > releases all locks', async () => {
    await adapter.acquire('a')
    await adapter.acquire('b')
    await adapter.releaseAll()

    const a = await adapter.acquire('a')
    const b = await adapter.acquire('b')
    expect(a).toBe(true)
    expect(b).toBe(true)

    await adapter.release('a')
    await adapter.release('b')
  })

  // Constructor validation
  it('constructor > throws without rawSql', () => {
    expect(() => new NeonLockingAdapter(null as any)).toThrow()
  })
})

describe('stringToAdvisoryLockKey', () => {
  it('produces consistent hash for same input', () => {
    const a = stringToAdvisoryLockKey('test-key')
    const b = stringToAdvisoryLockKey('test-key')
    expect(a).toBe(b)
  })

  it('produces different hashes for different inputs', () => {
    const a = stringToAdvisoryLockKey('key-1')
    const b = stringToAdvisoryLockKey('key-2')
    expect(a).not.toBe(b)
  })

  it('returns a bigint', () => {
    const hash = stringToAdvisoryLockKey('hello')
    expect(typeof hash).toBe('bigint')
  })
})
