// Portable app bootstrap — re-exported for external hosts (Next.js, Nuxt, etc.)
// The standalone HTTP server is now handled by Nitro (host-nitro).

import type { MantaApp } from '@manta/core'

// Re-export for external host usage
export { type BootstrapOptions, type BootstrappedApp, bootstrapApp } from './bootstrap/bootstrap-app'

/**
 * MantaRequest — the request object passed to route handlers.
 *
 * @example
 * export async function GET(req: MantaRequest) {
 *   // New way — typed, with autocompletion
 *   const products = await req.app.modules.product.list()
 *
 *   // Legacy way — still works
 *   const svc = req.scope.resolve('productModuleService')
 * }
 */
export interface MantaRequest extends Request {
  validatedBody?: unknown
  params: Record<string, string>
  requestId: string
  /** Typed application object — preferred for new code */
  // biome-ignore lint/suspicious/noExplicitAny: modules are dynamically discovered
  app: MantaApp<any>
  /** Query service — shorthand for req.app.resolve('query') */
  query: import('@manta/core').QueryService
  /** Workflow registry — shorthand for req.app.workflows */
  // biome-ignore lint/suspicious/noExplicitAny: workflow functions are dynamic
  workflows: Record<string, (...args: any[]) => Promise<unknown>>
  /** Parsed query string fields (e.g. ?fields=id,title) */
  queryFields?: string[]
  /** @deprecated Use req.app instead */
  scope: { resolve<T = unknown>(key: string): T }
}

/**
 * Extract the request body from a MantaRequest.
 * Uses the pre-validated body if available (set by H3 middleware),
 * otherwise falls back to parsing the JSON body.
 */
export async function getRequestBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  const mantaReq = req as MantaRequest
  if (mantaReq.validatedBody !== undefined) return mantaReq.validatedBody as T
  try {
    return (await req.clone().json()) as T
  } catch {
    return {} as T
  }
}
