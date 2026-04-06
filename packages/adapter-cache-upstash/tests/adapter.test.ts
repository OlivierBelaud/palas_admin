// UpstashCacheAdapter — unit tests (Redis mocked)
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @upstash/redis
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  flushdb: vi.fn(),
}

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(() => mockRedis),
}))

import { UpstashCacheAdapter } from '../src'

describe('UpstashCacheAdapter', () => {
  let cache: UpstashCacheAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    cache = new UpstashCacheAdapter({ url: 'https://fake.upstash.io', token: 'fake-token' })
  })

  // C-01 — basic set/get roundtrip
  it('get > returns value from Redis', async () => {
    mockRedis.get.mockResolvedValue('hello')
    const result = await cache.get('key')
    expect(result).toBe('hello')
    expect(mockRedis.get).toHaveBeenCalledWith('key')
  })

  // C-03 — get returns null for nonexistent key
  it('get > returns null when Redis returns null', async () => {
    mockRedis.get.mockResolvedValue(null)
    const result = await cache.get('nonexistent')
    expect(result).toBeNull()
  })

  // C-01 — set with TTL
  it('set > calls Redis set with TTL', async () => {
    mockRedis.set.mockResolvedValue('OK')
    await cache.set('key', 'value', 60)
    expect(mockRedis.set).toHaveBeenCalledWith('key', 'value', { ex: 60 })
  })

  // set without TTL
  it('set > calls Redis set without TTL', async () => {
    mockRedis.set.mockResolvedValue('OK')
    await cache.set('key', 'value')
    expect(mockRedis.set).toHaveBeenCalledWith('key', 'value')
  })

  // C-04 — invalidate calls del
  it('invalidate > calls Redis del', async () => {
    mockRedis.del.mockResolvedValue(1)
    await cache.invalidate('key')
    expect(mockRedis.del).toHaveBeenCalledWith('key')
  })

  // C-05 — clear calls flushdb
  it('clear > calls Redis flushdb', async () => {
    mockRedis.flushdb.mockResolvedValue('OK')
    await cache.clear()
    expect(mockRedis.flushdb).toHaveBeenCalled()
  })

  // Constructor validation
  it('constructor > throws without credentials', () => {
    expect(() => new UpstashCacheAdapter({ url: '', token: '' })).toThrow()
  })
})
