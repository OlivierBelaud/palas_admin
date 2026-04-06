// Request context via AsyncLocalStorage.
// Each HTTP request gets its own context (auth, requestId) without scopes.
// In serverless: one request per process, but this also works in dev (long-running server).

import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  /** Unique request ID */
  requestId: string
  /** Auth context (type, id, etc.) */
  authContext?: {
    type: string
    id: string
    [key: string]: unknown
  }
  /** Custom per-request data */
  [key: string]: unknown
}

const storage = new AsyncLocalStorage<RequestContext>()

/**
 * Run a function within a request context.
 * All code in the callback (and its async descendants) can access the context.
 *
 * @example
 * // In HTTP middleware
 * runInRequestContext({ requestId: crypto.randomUUID(), authContext }, async () => {
 *   await handleRoute(req)
 * })
 */
export function runInRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn)
}

/**
 * Get the current request context.
 * Returns undefined if called outside a request (e.g., during boot, in a cron job).
 *
 * @example
 * const ctx = getRequestContext()
 * if (ctx?.authContext) {
 *   console.log('User:', ctx.authContext.id)
 * }
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore()
}
