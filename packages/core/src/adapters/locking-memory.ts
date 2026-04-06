// SPEC-066 — InMemoryLockingAdapter implements ILockingPort

import { MantaError } from '../errors/manta-error'
import type { ILockingPort } from '../ports'

export class InMemoryLockingAdapter implements ILockingPort {
  private _locks = new Map<string, { ownerId: string; expiresAt: number | null }>()
  private _waitQueues = new Map<string, Array<() => void>>()

  async execute<T>(keys: string[], job: () => Promise<T>, options?: { timeout?: number }): Promise<T> {
    const ownerId = crypto.randomUUID()
    const acquired = await this.acquire(keys, { ownerId, expire: options?.timeout })

    if (!acquired) {
      // Wait for lock release
      await new Promise<void>((resolve, reject) => {
        const timer = options?.timeout
          ? setTimeout(() => reject(new MantaError('CONFLICT', 'Lock timeout')), options.timeout)
          : null

        for (const key of keys) {
          if (!this._waitQueues.has(key)) this._waitQueues.set(key, [])
          this._waitQueues.get(key)!.push(() => {
            if (timer) clearTimeout(timer)
            resolve()
          })
        }
      })

      const retryAcquired = await this.acquire(keys, { ownerId, expire: options?.timeout })
      if (!retryAcquired) {
        throw new MantaError('CONFLICT', `Failed to acquire lock after waiting: ${keys.join(', ')}`)
      }
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
    const now = Date.now()

    // Check all keys first (atomic — L-06)
    for (const key of keyArray) {
      const lock = this._locks.get(key)
      if (lock && (lock.expiresAt === null || lock.expiresAt > now)) {
        return false // Already locked
      }
    }

    // Acquire all
    const expiresAt = options?.expire ? now + options.expire : null
    for (const key of keyArray) {
      this._locks.set(key, { ownerId, expiresAt })
    }
    return true
  }

  async release(keys: string | string[], options?: { ownerId?: string }): Promise<void> {
    const keyArray = Array.isArray(keys) ? keys : [keys]
    for (const key of keyArray) {
      const lock = this._locks.get(key)
      if (lock && (!options?.ownerId || lock.ownerId === options.ownerId)) {
        this._locks.delete(key)
        // Notify waiters
        const waiters = this._waitQueues.get(key) ?? []
        const next = waiters.shift()
        if (next) next()
      }
    }
  }

  async releaseAll(options?: { ownerId?: string }): Promise<void> {
    if (options?.ownerId) {
      for (const [key, lock] of this._locks) {
        if (lock.ownerId === options.ownerId) this._locks.delete(key)
      }
    } else {
      this._locks.clear()
    }
  }

  _reset() {
    this._locks.clear()
    this._waitQueues.clear()
  }
}
