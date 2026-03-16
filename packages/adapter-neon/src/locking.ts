// NeonLockingAdapter — distributed locking via PostgreSQL advisory locks
import type { ILockingPort } from "@manta/core/ports"
import type postgres from "postgres"

// Convert string key to a consistent int64 for pg_advisory_lock
function keyToInt(key: string): bigint {
  let hash = BigInt(0)
  for (let i = 0; i < key.length; i++) {
    hash = (hash * BigInt(31) + BigInt(key.charCodeAt(i))) & BigInt("0x7FFFFFFFFFFFFFFF")
  }
  return hash
}

export class NeonLockingAdapter implements ILockingPort {
  constructor(private sql: postgres.Sql) {}

  async execute<T>(keys: string[], job: () => Promise<T>, options?: { timeout?: number }): Promise<T> {
    const acquired = await this.acquire(keys, { expire: options?.timeout })
    if (!acquired) {
      throw new Error(`Failed to acquire locks: ${keys.join(", ")}`)
    }
    try {
      return await job()
    } finally {
      await this.release(keys)
    }
  }

  async acquire(keys: string | string[], options?: { ownerId?: string; expire?: number }): Promise<boolean> {
    const keyArray = Array.isArray(keys) ? keys : [keys]
    for (const key of keyArray) {
      const lockId = keyToInt(key)
      const rows = await this.sql`SELECT pg_try_advisory_lock(${lockId}::bigint) as acquired`
      if (!rows[0]?.acquired) {
        // Release any locks we already acquired
        for (const prevKey of keyArray) {
          if (prevKey === key) break
          await this.sql`SELECT pg_advisory_unlock(${keyToInt(prevKey)}::bigint)`
        }
        return false
      }
    }
    return true
  }

  async release(keys: string | string[], options?: { ownerId?: string }): Promise<void> {
    const keyArray = Array.isArray(keys) ? keys : [keys]
    for (const key of keyArray) {
      const lockId = keyToInt(key)
      await this.sql`SELECT pg_advisory_unlock(${lockId}::bigint)`
    }
  }

  async releaseAll(options?: { ownerId?: string }): Promise<void> {
    await this.sql`SELECT pg_advisory_unlock_all()`
  }
}
