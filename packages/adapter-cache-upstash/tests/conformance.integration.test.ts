// UpstashCacheAdapter — ICachePort conformance (requires real Upstash Redis)
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const SKIP = !process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN

import type { ICachePort } from '@manta/core'
import { UpstashCacheAdapter } from '../src'

describe.skipIf(SKIP)('UpstashCacheAdapter — ICachePort conformance', () => {
  let cache: ICachePort

  beforeEach(async () => {
    cache = new UpstashCacheAdapter()
    await cache.clear()
  })

  afterAll(async () => {
    if (cache) await cache.clear()
  })

  it('C-01 — set/get roundtrip', async () => {
    await cache.set('key', 'value', 60)
    const result = await cache.get('key')
    expect(result).toBe('value')
  })

  it('C-03 — get returns null for nonexistent key', async () => {
    const result = await cache.get('nonexistent-key-12345')
    expect(result).toBeNull()
  })

  it('C-04 — invalidate removes exact key', async () => {
    await cache.set('user:1', 'a', 60)
    await cache.set('user:2', 'b', 60)
    await cache.invalidate('user:1')
    expect(await cache.get('user:1')).toBeNull()
    expect(await cache.get('user:2')).toBe('b')
  })

  it('C-05 — clear removes all entries', async () => {
    await cache.set('a', '1', 60)
    await cache.set('b', '2', 60)
    await cache.clear()
    expect(await cache.get('a')).toBeNull()
    expect(await cache.get('b')).toBeNull()
  })

  it('C-08 — set overwrites existing value', async () => {
    await cache.set('key', 'v1', 60)
    await cache.set('key', 'v2', 60)
    expect(await cache.get('key')).toBe('v2')
  })

  it('C-09 — JSON serialization roundtrip', async () => {
    const obj = { nested: { deep: true } }
    await cache.set('obj', obj, 60)
    const result = await cache.get('obj')
    expect(result).toEqual(obj)
  })
})
