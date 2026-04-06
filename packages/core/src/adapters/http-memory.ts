// SPEC-039 — InMemoryHttpAdapter implements IHttpPort

import { MantaError } from '../errors/manta-error'
import type { IHttpPort } from '../ports'

interface RateLimitConfig {
  max: number
  windowMs: number
  keyFn?: (req: Request) => string
}

export class InMemoryHttpAdapter implements IHttpPort {
  private _routes: Array<{
    method: string
    pattern: RegExp
    paramNames: string[]
    handler: (req: Request) => Promise<Response> | Response
  }> = []

  private _rateLimits = new Map<string, RateLimitConfig>()
  private _rateLimitCounters = new Map<string, { count: number; resetAt: number }>()

  private static readonly ERROR_STATUS_MAP: Record<string, number> = {
    NOT_FOUND: 404,
    INVALID_DATA: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    DUPLICATE_ERROR: 409,
    CONFLICT: 409,
    NOT_ALLOWED: 405,
    UNEXPECTED_STATE: 500,
    DB_ERROR: 500,
    UNKNOWN_MODULES: 500,
    INVALID_STATE: 500,
    NOT_IMPLEMENTED: 501,
    RESOURCE_EXHAUSTED: 429,
  }

  registerRoute(method: string, path: string, handler: (req: Request) => Promise<Response> | Response): void {
    const paramNames: string[] = []
    const regexStr = path.replace(/:([^/]+)/g, (_match, paramName) => {
      paramNames.push(paramName)
      return '([^/]+)'
    })
    const pattern = new RegExp(`^${regexStr}$`)
    this._routes.push({ method: method.toUpperCase(), pattern, paramNames, handler })
  }

  /**
   * Configure rate limiting for a namespace (e.g., '/store', '/admin').
   */
  configureRateLimit(namespace: string, config: RateLimitConfig): void {
    this._rateLimits.set(namespace, config)
  }

  async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url, 'http://localhost')
    const method = req.method.toUpperCase()
    const pathname = url.pathname

    // Step 1: RequestID
    const incomingRequestId = req.headers.get('x-request-id')
    const requestId = incomingRequestId || crypto.randomUUID()

    // Step 3: Rate limiting
    const rateLimitResponse = this._checkRateLimit(req, pathname)
    if (rateLimitResponse) {
      rateLimitResponse.headers.set('x-request-id', requestId)
      return rateLimitResponse
    }

    for (const route of this._routes) {
      if (route.method !== method) continue
      const match = pathname.match(route.pattern)
      if (match) {
        try {
          const response = await route.handler(req)
          // Add requestId to response
          const headers = new Headers(response.headers)
          headers.set('x-request-id', requestId)
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          })
        } catch (error: unknown) {
          const errorResponse = this._handleError(error)
          const headers = new Headers(errorResponse.headers)
          headers.set('x-request-id', requestId)
          return new Response(errorResponse.body, {
            status: errorResponse.status,
            statusText: errorResponse.statusText,
            headers,
          })
        }
      }
    }

    return new Response(JSON.stringify({ type: 'NOT_FOUND', message: 'Route not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
    })
  }

  private _checkRateLimit(req: Request, pathname: string): Response | null {
    // Find matching rate limit config by namespace prefix
    let matchedConfig: RateLimitConfig | undefined
    let matchedNamespace: string | undefined

    for (const [namespace, config] of this._rateLimits) {
      if (pathname.startsWith(namespace)) {
        matchedConfig = config
        matchedNamespace = namespace
        break
      }
    }

    // Also check global rate limit (empty string key)
    if (!matchedConfig && this._rateLimits.has('')) {
      matchedConfig = this._rateLimits.get('')!
      matchedNamespace = ''
    }

    if (!matchedConfig || matchedNamespace === undefined) return null

    const keyFn = matchedConfig.keyFn ?? (() => 'global')
    const clientKey = `${matchedNamespace}:${keyFn(req)}`
    const now = Date.now()

    let counter = this._rateLimitCounters.get(clientKey)
    if (!counter || now >= counter.resetAt) {
      counter = { count: 0, resetAt: now + matchedConfig.windowMs }
      this._rateLimitCounters.set(clientKey, counter)
    }

    counter.count++

    if (counter.count > matchedConfig.max) {
      const retryAfter = Math.ceil((counter.resetAt - now) / 1000)
      return new Response(JSON.stringify({ type: 'RESOURCE_EXHAUSTED', message: 'Rate limit exceeded' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(matchedConfig.max),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(counter.resetAt / 1000)),
        },
      })
    }

    return null
  }

  private _handleError(error: unknown): Response {
    if (MantaError.is(error)) {
      const status = InMemoryHttpAdapter.ERROR_STATUS_MAP[error.type] ?? 500
      const body: Record<string, unknown> = {
        type: error.type,
        message: error.message,
      }
      if (error.code) {
        body.code = error.code
      }
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    }

    // Unknown error: 500 with no internal details leaked
    return new Response(JSON.stringify({ type: 'UNEXPECTED_STATE', message: 'An internal error occurred' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  _reset() {
    this._routes = []
    this._rateLimits.clear()
    this._rateLimitCounters.clear()
  }
}
