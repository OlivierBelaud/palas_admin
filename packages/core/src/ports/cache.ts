// SPEC-064/077 — ICachePort interface

/**
 * Cache port contract.
 * Adapters: InMemoryCacheAdapter (dev), UpstashCacheAdapter (prod).
 */
export interface ICachePort {
  /**
   * Get a cached value by key.
   * @param key - The cache key
   * @returns The cached string value, or null if not found / expired
   */
  get(key: string): Promise<string | null>

  /**
   * Set a value in the cache.
   * @param key - The cache key
   * @param data - The string value to cache
   * @param ttl - Time-to-live in seconds (optional)
   */
  set(key: string, data: string, ttl?: number): Promise<void>

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
