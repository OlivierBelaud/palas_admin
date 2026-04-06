// SPEC-064/077 — ICachePort interface

/**
 * Cache port contract.
 * Adapters: InMemoryCacheAdapter (dev), UpstashCacheAdapter (prod).
 */
export interface ICachePort {
  /**
   * Get a cached value by key.
   * @param key - The cache key
   * @returns The cached value, or null if not found / expired
   */
  get(key: string): Promise<unknown>

  /**
   * Set a value in the cache.
   * @param key - The cache key
   * @param data - The value to cache (strings stored as-is, objects JSON-serialized)
   * @param ttl - Time-to-live in seconds (optional)
   */
  set(key: string, data: unknown, ttl?: number): Promise<void>

  /**
   * Invalidate a specific cache key (exact match, no patterns).
   * @param key - The cache key to invalidate
   */
  invalidate(key: string): Promise<void>

  /**
   * Clear all cached entries.
   */
  clear(): Promise<void>
}
