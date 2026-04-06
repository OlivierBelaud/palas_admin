import type { ICachePort, TestMantaApp } from '@manta/core'
import {
  createTestMantaApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryLockingAdapter,
  TestLogger,
} from '@manta/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const makeInfra = () => ({
  eventBus: new InMemoryEventBusAdapter(),
  logger: new TestLogger(),
  cache: new InMemoryCacheAdapter(),
  locking: new InMemoryLockingAdapter(),
  file: new InMemoryFileAdapter(),
  db: {},
})

describe('ICachePort Conformance', () => {
  let cache: ICachePort
  let app: TestMantaApp

  beforeEach(() => {
    app = createTestMantaApp({ infra: makeInfra() })
    cache = app.infra.cache
  })

  afterEach(async () => {
    await app.dispose()
  })

  // C-01 — SPEC-064: basic set/get roundtrip
  it('set/get > roundtrip basique', async () => {
    await cache.set('key', 'value', 60)
    const result = await cache.get('key')
    expect(result).toBe('value')
  })

  // C-02 — SPEC-064: TTL expiration
  it('set/get > TTL respecté', async () => {
    vi.useFakeTimers()
    await cache.set('key', 'value', 1)
    vi.advanceTimersByTime(1100)
    const result = await cache.get('key')
    expect(result).toBeNull()
    vi.useRealTimers()
  })

  // C-03 — SPEC-064: get returns null for nonexistent key
  it('get > clé inexistante', async () => {
    const result = await cache.get('nonexistent')
    expect(result).toBeNull()
  })

  // C-04 — SPEC-064: invalidate removes exact key only
  it('invalidate > clé exacte', async () => {
    await cache.set('user:1', 'a', 60)
    await cache.set('user:2', 'b', 60)
    await cache.invalidate('user:1')
    expect(await cache.get('user:1')).toBeNull()
    expect(await cache.get('user:2')).toBe('b')
  })

  // C-04b — SPEC-078: version-key grouped invalidation
  // Note: This test validates the version-key pattern at the ICachePort level.
  // The version-key logic is an application-level pattern, not a port method.
  // ICachePort just needs to support exact key set/get/invalidate — the pattern works on top.
  it('version-key > invalidation groupée', async () => {
    // Simulate version-key pattern: keys include version number
    await cache.set('cache:v1:user:1', 'alice', 300)
    await cache.set('cache:v1:user:2', 'bob', 300)
    // Store current version
    await cache.set('cache:users:version', '1', 300)

    // "Invalidate" by incrementing version
    await cache.set('cache:users:version', '2', 300)

    // Old keys are still physically present (expire via TTL)
    expect(await cache.get('cache:v1:user:1')).toBe('alice')
    expect(await cache.get('cache:v1:user:2')).toBe('bob')

    // But business code reads current version first, then constructs key
    const currentVersion = await cache.get('cache:users:version')
    expect(currentVersion).toBe('2')
    // New versioned key has no data yet
    expect(await cache.get(`cache:v${currentVersion}:user:1`)).toBeNull()
  })

  // C-05 — SPEC-064: clear removes all entries
  it('clear > supprime tout', async () => {
    await cache.set('a', '1', 60)
    await cache.set('b', '2', 60)
    await cache.clear()
    expect(await cache.get('a')).toBeNull()
    expect(await cache.get('b')).toBeNull()
  })

  // C-06 — SPEC-078: version-key invalidation preserves old data until TTL
  it('version-key > invalidation par version', async () => {
    const dataV1 = JSON.stringify({ users: ['alice'] })
    const dataV2 = JSON.stringify({ users: ['alice', 'bob'] })

    await cache.set('cache:v1:users', dataV1, 300)
    // Increment version and set new data
    await cache.set('cache:v2:users', dataV2, 300)

    // Old version data still present (expires via TTL)
    expect(await cache.get('cache:v1:users')).toBe(dataV1)
    // New version data available
    expect(await cache.get('cache:v2:users')).toBe(dataV2)
    // Business code reads only current version (v2)
  })

  // C-07 — SPEC-064: concurrent access safety
  it('set/get > concurrent access', async () => {
    const promises: Promise<void>[] = []
    for (let i = 0; i < 100; i++) {
      promises.push(cache.set(`key:${i}`, `value:${i}`, 60))
    }
    await Promise.all(promises)

    const getPromises: Promise<unknown>[] = []
    for (let i = 0; i < 100; i++) {
      getPromises.push(cache.get(`key:${i}`))
    }
    const results = await Promise.all(getPromises)

    for (let i = 0; i < 100; i++) {
      expect(results[i]).toBe(`value:${i}`)
    }
  })

  // C-08 — SPEC-064: set overwrites existing value
  it('set > écrase valeur existante', async () => {
    await cache.set('key', 'v1', 60)
    await cache.set('key', 'v2', 60)
    expect(await cache.get('key')).toBe('v2')
  })

  // C-09 — SPEC-064: JSON serialization roundtrip
  it('set/get > sérialisation JSON', async () => {
    const obj = { nested: { deep: true } }
    await cache.set('obj', obj, 60)
    const result = await cache.get('obj')
    expect(result).toEqual(obj)
  })
})
