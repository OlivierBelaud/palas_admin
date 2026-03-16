// SPEC-064/077 — InMemoryCacheAdapter implements ICachePort

import type { ICachePort } from '../ports'

export class InMemoryCacheAdapter implements ICachePort {
  private _store = new Map<string, { value: string; expiresAt: number | null }>()

  async get(key: string): Promise<string | null> {
    const entry = this._store.get(key)
    if (!entry) return null
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this._store.delete(key)
      return null
    }
    return entry.value
  }

  async set(key: string, data: string, ttl?: number): Promise<void> {
    const expiresAt = ttl ? Date.now() + ttl * 1000 : null
    this._store.set(key, { value: data, expiresAt })
  }

  async invalidate(key: string): Promise<void> {
    this._store.delete(key)
  }

  async clear(): Promise<void> {
    this._store.clear()
  }

  _reset() { this._store.clear() }
}
