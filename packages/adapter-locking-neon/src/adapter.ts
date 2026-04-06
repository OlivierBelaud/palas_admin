// SPEC-066 — NeonLockingAdapter implements ILockingPort
// Uses PostgreSQL advisory locks via raw SQL. Advisory locks are session-scoped —
// in serverless, the connection closes and locks auto-release.

import type { ILockingPort } from '@manta/core'
import { MantaError } from '@manta/core'
import { stringToAdvisoryLockKey } from './hash'

type RawSqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Array<Record<string, unknown>>>

export interface NeonLockingOptions {
  rawSql?: RawSqlFn
}

export class NeonLockingAdapter implements ILockingPort {
  private _rawSql: RawSqlFn
  private _owners = new Map<string, Set<string>>()
  private _expireTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(rawSql: RawSqlFn) {
    if (!rawSql) {
      throw new MantaError(
        'INVALID_STATE',
        'NeonLockingAdapter requires a rawSql function from IDatabasePort.getPool()',
      )
    }
    this._rawSql = rawSql
  }

  async execute<T>(keys: string[], job: () => Promise<T>, options?: { timeout?: number }): Promise<T> {
    const ownerId = crypto.randomUUID()
    const acquired = await this.acquire(keys, { ownerId, expire: options?.timeout })

    if (!acquired) {
      throw new MantaError('CONFLICT', `Failed to acquire locks for keys: ${keys.join(', ')}`)
    }

    try {
      return await job()
    } finally {
      await this.release(keys, { ownerId })
    }
  }

  async acquire(keys: string | string[], options?: { ownerId?: string; expire?: number }): Promise<boolean> {
    const keyArray = Array.isArray(keys) ? keys : [keys]
    const ownerId = options?.ownerId ?? crypto.randomUUID()
    const acquiredKeys: string[] = []

    // Try to acquire all locks atomically (L-06)
    for (const key of keyArray) {
      const lockKey = stringToAdvisoryLockKey(key)
      const result = await this._rawSql`SELECT pg_try_advisory_lock(${lockKey}::bigint) AS acquired`
      const acquired = result[0]?.acquired === true

      if (!acquired) {
        // Rollback: release all previously acquired locks
        for (const acquiredKey of acquiredKeys) {
          const releaseKey = stringToAdvisoryLockKey(acquiredKey)
          await this._rawSql`SELECT pg_advisory_unlock(${releaseKey}::bigint)`
        }
        return false
      }

      acquiredKeys.push(key)
    }

    // Track ownership
    if (!this._owners.has(ownerId)) {
      this._owners.set(ownerId, new Set())
    }
    for (const key of keyArray) {
      this._owners.get(ownerId)!.add(key)
    }

    // Set expire timer if requested
    if (options?.expire) {
      for (const key of keyArray) {
        const timer = setTimeout(async () => {
          await this._unlockKey(key)
          this._expireTimers.delete(key)
          // Remove from owner tracking
          for (const [_oid, keySet] of this._owners) {
            keySet.delete(key)
          }
        }, options.expire)
        this._expireTimers.set(key, timer)
      }
    }

    return true
  }

  async release(keys: string | string[], options?: { ownerId?: string }): Promise<void> {
    const keyArray = Array.isArray(keys) ? keys : [keys]

    for (const key of keyArray) {
      await this._unlockKey(key)

      // Clear expire timer
      const timer = this._expireTimers.get(key)
      if (timer) {
        clearTimeout(timer)
        this._expireTimers.delete(key)
      }

      // Remove from owner tracking
      if (options?.ownerId) {
        this._owners.get(options.ownerId)?.delete(key)
      } else {
        for (const [_oid, keySet] of this._owners) {
          keySet.delete(key)
        }
      }
    }
  }

  async releaseAll(options?: { ownerId?: string }): Promise<void> {
    if (options?.ownerId) {
      const keys = this._owners.get(options.ownerId)
      if (keys) {
        for (const key of keys) {
          await this._unlockKey(key)
          const timer = this._expireTimers.get(key)
          if (timer) {
            clearTimeout(timer)
            this._expireTimers.delete(key)
          }
        }
        this._owners.delete(options.ownerId)
      }
    } else {
      await this._rawSql`SELECT pg_advisory_unlock_all()`
      for (const timer of this._expireTimers.values()) {
        clearTimeout(timer)
      }
      this._expireTimers.clear()
      this._owners.clear()
    }
  }

  private async _unlockKey(key: string): Promise<void> {
    const lockKey = stringToAdvisoryLockKey(key)
    await this._rawSql`SELECT pg_advisory_unlock(${lockKey}::bigint)`
  }

  _reset() {
    for (const timer of this._expireTimers.values()) {
      clearTimeout(timer)
    }
    this._expireTimers.clear()
    this._owners.clear()
  }
}
