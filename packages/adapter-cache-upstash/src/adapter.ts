// SPEC-064/077 — UpstashCacheAdapter implements ICachePort

import { type ICachePort, MantaError } from '@manta/core'
import { Redis } from '@upstash/redis'

export interface UpstashCacheOptions {
  url?: string
  token?: string
}

export class UpstashCacheAdapter implements ICachePort {
  private _redis: Redis

  constructor(options: UpstashCacheOptions = {}) {
    const url = options.url ?? process.env.UPSTASH_REDIS_REST_URL
    const token = options.token ?? process.env.UPSTASH_REDIS_REST_TOKEN

    if (!url || !token) {
      throw new MantaError(
        'INVALID_DATA',
        'UpstashCacheAdapter requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (env or constructor options)',
      )
    }

    this._redis = new Redis({ url, token })
  }

  async get(key: string): Promise<unknown> {
    const value = await this._redis.get(key)
    return value ?? null
  }

  async set(key: string, data: unknown, ttl?: number): Promise<void> {
    const value = typeof data === 'string' ? data : JSON.stringify(data)
    if (ttl && ttl > 0) {
      await this._redis.set(key, value, { ex: ttl })
    } else {
      await this._redis.set(key, value)
    }
  }

  async invalidate(key: string): Promise<void> {
    await this._redis.del(key)
  }

  async clear(): Promise<void> {
    await this._redis.flushdb()
  }

  async ping(): Promise<boolean> {
    // Upstash Redis exposes PING as a REST command. Any successful response
    // (typically "PONG") means the backend is reachable.
    try {
      const result = await (this._redis as unknown as { ping: () => Promise<unknown> }).ping()
      return result !== null && result !== undefined
    } catch {
      return false
    }
  }

  _reset() {
    this._redis.flushdb()
  }
}
