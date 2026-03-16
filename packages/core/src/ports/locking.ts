// SPEC-066/089/090 — ILockingPort interface

/**
 * Locking port contract.
 * Adapters: InMemoryLocking (dev), Neon advisory locks (prod).
 */
export interface ILockingPort {
  /**
   * Execute a job while holding locks on the given keys.
   * Acquires locks, runs job, releases locks.
   * @param keys - Lock keys to acquire
   * @param job - The function to execute under lock
   * @param options - Optional timeout in ms
   * @returns The result of the job function
   */
  execute<T>(keys: string[], job: () => Promise<T>, options?: { timeout?: number }): Promise<T>

  /**
   * Manually acquire locks on one or more keys.
   * @param keys - Lock key(s) to acquire
   * @param options - Optional ownerId and expiration in ms
   * @returns True if all locks were acquired, false otherwise
   */
  acquire(keys: string | string[], options?: { ownerId?: string; expire?: number }): Promise<boolean>

  /**
   * Release locks on one or more keys.
   * @param keys - Lock key(s) to release
   * @param options - Optional ownerId to verify ownership
   */
  release(keys: string | string[], options?: { ownerId?: string }): Promise<void>

  /**
   * Release all locks held by an owner.
   * @param options - Optional ownerId filter
   */
  releaseAll(options?: { ownerId?: string }): Promise<void>
}
