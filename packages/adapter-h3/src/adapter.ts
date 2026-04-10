// SPEC-039 — H3Adapter implements IHttpPort

import { createServer, type Server } from 'node:http'
import { MantaError } from '@manta/core/errors'
import type { IHttpPort } from '@manta/core/ports'
import {
  createApp,
  createRouter,
  defineEventHandler,
  type EventHandler,
  getMethod,
  getRequestHeader,
  type H3Event,
  setResponseHeader,
  setResponseStatus,
  toNodeListener,
} from 'h3'

type App = ReturnType<typeof createApp>
type Router = ReturnType<typeof createRouter>

import { extractRequestId, mapErrorToResponse, parseBody, setCorsHeaders, setSecurityHeaders } from './pipeline'

export interface AuthContext {
  id: string
  type: string
  [key: string]: unknown
}

export type AuthVerifier = (token: string) => Promise<AuthContext | null>
export type SessionVerifier = (sessionId: string) => Promise<AuthContext | null>

/** Custom middleware handler for a context (from src/middleware/{ctx}.ts). */
export type ContextMiddlewareHandler = (
  req: { method: string; url: string; headers: Record<string, string | string[] | undefined>; body?: unknown },
  authContext: AuthContext | null,
) => Promise<AuthContext | null>

/** Per-context auth rule registered by defineUser via bootstrap. */
interface ContextAuthRule {
  prefix: string
  actorType: string
  publicPaths: Set<string>
  customMiddleware?: ContextMiddlewareHandler
}

/**
 * Routes that do NOT require authentication.
 * Checks per-context public paths registered by defineUser.
 */
export function isPublicRoute(path: string, contextRules?: ContextAuthRule[]): boolean {
  if (contextRules) {
    for (const rule of contextRules) {
      if (rule.publicPaths.has(path)) return true
    }
  }
  return false
}

/**
 * Determines if a path requires authentication.
 * Any /api/{ctx}/* path where a defineUser(ctx) exists requires auth (except public paths).
 */
export function requiresAuthentication(path: string, contextRules?: ContextAuthRule[]): boolean {
  if (contextRules) {
    for (const rule of contextRules) {
      if (path.startsWith(rule.prefix)) {
        return !rule.publicPaths.has(path)
      }
    }
  }
  return false
}

export interface RouteOptions {
  bodySchema?: { parse: (data: unknown) => unknown }
}

export interface RateLimitOptions {
  enabled: boolean
  windowMs?: number
  maxRequests?: number
}

/**
 * Readiness probe — a single infrastructure health check (DB, cache, eventbus).
 * Each probe is awaited with a short timeout by the /health/ready handler.
 * A probe that throws or resolves to false is reported as 'error'.
 */
export type ReadinessProbe = () => Promise<boolean>

export interface H3AdapterOptions {
  port?: number
  host?: string
  isDev?: boolean
  allowedOrigins?: string[]
  rateLimit?: RateLimitOptions
  sessionVerifier?: SessionVerifier
  /**
   * Optional set of readiness probes wired by the bootstrap layer.
   * Only configured ports are included — absent infra is simply omitted
   * from the checks payload, never reported as failing.
   */
  readinessProbes?: Record<string, ReadinessProbe>
  /**
   * Timeout in ms for each readiness probe (default 500ms).
   * Probes that exceed this budget are reported as 'error'.
   */
  readinessTimeoutMs?: number
}

export class H3Adapter implements IHttpPort {
  private _app: App
  private _router: Router
  private _server: Server | null = null
  private _startedAt: number
  private _isDev: boolean
  private _port: number
  private _host: string
  private _authVerifier: AuthVerifier | null = null
  private _sessionVerifier: SessionVerifier | null = null
  private _rbacEnabled = false
  private _allowedOrigins?: string[]
  private _options: H3AdapterOptions
  private _rateLimits = new Map<string, { count: number; resetAt: number }>()
  private _contextAuthRules: ContextAuthRule[] = []

  constructor(options: H3AdapterOptions = {}) {
    this._options = options
    this._app = createApp()
    this._router = createRouter()
    this._isDev = options.isDev ?? true
    this._port = options.port ?? 9000
    this._host = options.host ?? '0.0.0.0'
    this._allowedOrigins = options.allowedOrigins
    this._startedAt = Date.now()
    this._sessionVerifier = options.sessionVerifier ?? null

    this._registerHealthRoutes()
    this._app.use(this._router as unknown as EventHandler)
  }

  /** Expose the underlying H3 App for embedding in hosts (e.g. Nitro). */
  getApp(): App {
    return this._app
  }

  setAuthVerifier(verifier: AuthVerifier): void {
    this._authVerifier = verifier
  }

  setSessionVerifier(verifier: SessionVerifier): void {
    this._sessionVerifier = verifier
  }

  /**
   * Register per-context auth rules (from defineUser).
   * Paths under /api/{ctx}/ will require JWT with matching actor_type,
   * except for public paths (login, forgot-password, etc.).
   */
  registerContextAuth(
    contextName: string,
    actorType: string,
    publicPaths: string[],
    customMiddleware?: ContextMiddlewareHandler,
  ): void {
    this._contextAuthRules.push({
      prefix: `/api/${contextName}/`,
      actorType,
      publicPaths: new Set(publicPaths),
      customMiddleware,
    })
  }

  enableRbac(enabled: boolean): void {
    this._rbacEnabled = enabled
  }

  registerRoute(
    method: string,
    path: string,
    handler: (req: Request) => Promise<Response> | Response,
    options?: RouteOptions,
  ): void {
    const h3Handler = defineEventHandler(async (event: H3Event) => {
      return this._runPipeline(event, handler, options)
    })

    const m = method.toLowerCase()
    switch (m) {
      case 'get':
        this._router.get(path, h3Handler)
        break
      case 'post':
        this._router.post(path, h3Handler)
        break
      case 'put':
        this._router.put(path, h3Handler)
        break
      case 'delete':
        this._router.delete(path, h3Handler)
        break
      case 'patch':
        this._router.patch(path, h3Handler)
        break
      case 'options':
        this._router.options(path, h3Handler)
        break
      default:
        this._router.get(path, h3Handler)
        break
    }

    // Also store in internal registry for handleRequest()
    this._registerInternalRoute(method, path, handler, options)
  }

  async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url, 'http://localhost')
    const method = req.method.toUpperCase()
    const path = url.pathname

    const healthResponse = this._handleHealthRequest(method, path)
    if (healthResponse) return await healthResponse

    return this._internalHandleRequest(req)
  }

  async listen(): Promise<void> {
    return new Promise((resolve) => {
      this._server = createServer(toNodeListener(this._app))
      this._server.listen(this._port, this._host, () => {
        resolve()
      })
    })
  }

  async close(): Promise<void> {
    if (this._server) {
      return new Promise((resolve, reject) => {
        this._server!.close((err) => {
          if (err) reject(err)
          else resolve()
        })
        this._server = null
      })
    }
  }

  get port(): number {
    return this._port
  }

  // The 12-step pipeline (SPEC-039)
  private async _runPipeline(
    event: H3Event,
    handler: (req: Request) => Promise<Response> | Response,
    options?: RouteOptions,
  ): Promise<string | void> {
    try {
      // Step 1 -- RequestID
      const requestId = extractRequestId(event)
      setResponseHeader(event, 'x-request-id', requestId)

      // Step 1.5 -- Security headers
      setSecurityHeaders(event)

      // Step 2 -- CORS
      const url = event.path ?? '/'
      setCorsHeaders(event, url, this._allowedOrigins)

      // OPTIONS preflight
      if (getMethod(event) === 'OPTIONS') {
        setResponseStatus(event, 204)
        return ''
      }

      // Step 3 -- Rate limit (SPEC-039b)
      if (this._options?.rateLimit?.enabled) {
        const ip = getRequestHeader(event, 'x-forwarded-for') ?? getRequestHeader(event, 'x-real-ip') ?? 'unknown'
        const { allowed, remaining, resetAt } = this._checkRateLimit(ip)
        setResponseHeader(event, 'X-RateLimit-Remaining', String(remaining))
        setResponseHeader(event, 'X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)))
        if (!allowed) {
          setResponseStatus(event, 429)
          return JSON.stringify({ type: 'RESOURCE_EXHAUSTED', message: 'Too many requests' })
        }
      }

      // Step 4 -- Scope (no-op)

      // Step 5 -- Body parsing
      let body = await parseBody(event)

      // Step 6 -- Auth
      let authContext: AuthContext | null = null
      if (this._authVerifier) {
        authContext = await this._runAuthStep(event, url)
      }

      // Step 7 -- Publishable key (no-op)

      // Step 8 -- Validation
      if (options?.bodySchema && body !== undefined) {
        body = this._runValidationStep(body, options.bodySchema)
      }

      // Step 9 -- Custom middlewares (no-op)

      // Step 10 -- RBAC
      if (this._rbacEnabled) {
        this._runRbacStep(url, authContext)
      }

      // Step 11 -- Handler
      const reqUrl = new URL(event.path ?? '/', `http://${this._host}:${this._port}`)
      const method = getMethod(event)
      const contentType = getRequestHeader(event, 'content-type') ?? 'application/json'
      const reqHeaders: Record<string, string> = {
        'content-type': contentType,
        'x-request-id': requestId,
      }
      // Forward user-agent for proxy routes (PostHog, etc.)
      const ua = getRequestHeader(event, 'user-agent')
      if (ua) reqHeaders['user-agent'] = ua

      const reqInit: RequestInit = {
        method,
        headers: reqHeaders,
      }
      // Include parsed body for CQRS routes (proxy routes bypass this pipeline entirely)
      if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && body !== undefined) {
        reqInit.body = JSON.stringify(body)
      }

      const request = new Request(reqUrl.toString(), reqInit)
      Object.defineProperty(request, 'validatedBody', { value: body, enumerable: true })
      Object.defineProperty(request, 'requestId', { value: requestId, enumerable: true })
      if (authContext) {
        Object.defineProperty(request, 'authContext', { value: authContext, enumerable: true })
      }

      const response = await handler(request)

      // Step 12 -- Send response
      setResponseStatus(event, response.status)
      response.headers.forEach((value, key) => {
        setResponseHeader(event, key, value)
      })
      setResponseHeader(event, 'content-type', response.headers.get('content-type') ?? 'application/json')

      // HEAD requests: return headers but no body (HTTP spec)
      if (getMethod(event) === 'HEAD') {
        return ''
      }

      const responseBody = await response.text()
      return responseBody
    } catch (error) {
      // Step 12 -- Error handler
      const { status, body } = mapErrorToResponse(error, this._isDev)
      setResponseStatus(event, status)
      setResponseHeader(event, 'content-type', 'application/json')
      return JSON.stringify(body)
    }
  }

  // Step 3 -- Rate limiting (SPEC-039b)
  private _checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now()
    const windowMs = this._options?.rateLimit?.windowMs ?? 60000
    const max = this._options?.rateLimit?.maxRequests ?? 100

    const entry = this._rateLimits.get(ip)
    if (!entry || now >= entry.resetAt) {
      this._rateLimits.set(ip, { count: 1, resetAt: now + windowMs })
      return { allowed: true, remaining: max - 1, resetAt: now + windowMs }
    }

    entry.count++
    if (entry.count > max) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt }
    }
    return { allowed: true, remaining: max - entry.count, resetAt: entry.resetAt }
  }

  // Step 6 -- Auth: verify Bearer token, API key, or cookie session
  private async _runAuthStep(event: H3Event, path: string): Promise<AuthContext | null> {
    let authContext: AuthContext | null = null

    // 1. Bearer token
    const authHeader = getRequestHeader(event, 'authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (token && this._authVerifier) {
      authContext = await this._authVerifier(token)
    }

    // 2. API key (x-api-key header)
    if (!authContext) {
      const apiKey = getRequestHeader(event, 'x-api-key')
      if (apiKey && this._authVerifier) {
        authContext = await this._authVerifier(apiKey)
      }
    }

    // 3. Cookie session (manta.sid or session cookie)
    if (!authContext) {
      const cookieHeader = getRequestHeader(event, 'cookie')
      if (cookieHeader && this._sessionVerifier) {
        const cookies = parseCookies(cookieHeader)
        const sessionId = cookies['manta.sid'] ?? cookies.session
        if (sessionId) {
          authContext = await this._sessionVerifier(sessionId)
        }
      }
    }

    if (requiresAuthentication(path, this._contextAuthRules) && !authContext && this._authVerifier) {
      throw new MantaError('UNAUTHORIZED', 'Authentication required')
    }

    // V2: verify actor_type matches the context (or delegate to custom middleware)
    if (this._contextAuthRules.length > 0) {
      for (const rule of this._contextAuthRules) {
        if (path.startsWith(rule.prefix) && !rule.publicPaths.has(path)) {
          if (rule.customMiddleware) {
            // Custom middleware replaces the default actor_type check
            const headers: Record<string, string | string[] | undefined> = {}
            for (const [k, v] of new Request(path).headers) headers[k] = v
            // Extract actual headers from event
            const rawHeaders =
              event.headers ?? (event.node?.req?.headers as Record<string, string | string[] | undefined>)
            if (rawHeaders) Object.assign(headers, rawHeaders)

            authContext = await rule.customMiddleware({ method: getMethod(event), url: path, headers }, authContext)
          } else if (authContext && authContext.type !== rule.actorType) {
            throw new MantaError(
              'FORBIDDEN',
              `Actor type "${authContext.type}" cannot access ${rule.prefix} (requires "${rule.actorType}")`,
            )
          }
          break
        }
      }
    }

    return authContext
  }

  // Step 8 -- Validation
  private _runValidationStep(body: unknown, schema: { parse: (data: unknown) => unknown }): unknown {
    try {
      return schema.parse(body)
    } catch (err) {
      const issues = (err as { issues?: Array<{ path: (string | number)[]; message: string }> }).issues ?? []
      const details = issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      const detail = details.map((d) => `${d.path}: ${d.message}`).join(', ')
      throw new MantaError('INVALID_DATA', detail ? `Validation failed: ${detail}` : 'Validation failed')
    }
  }

  // Step 10 -- RBAC (basic namespace check)
  private _runRbacStep(path: string, authContext: AuthContext | null): void {
    // Basic RBAC: admin routes require authenticated actor
    // More advanced RBAC (role checks) would be implemented later
    if (path.startsWith('/api/admin') && !authContext && this._rbacEnabled) {
      throw new MantaError('FORBIDDEN', 'Access denied')
    }
  }

  // Health endpoints -- SPEC-072 / BC-F22
  private _registerHealthRoutes(): void {
    this._app.use(
      '/health/live',
      defineEventHandler(() => {
        return {
          status: 'alive',
          uptime_ms: Date.now() - this._startedAt,
        }
      }),
    )

    this._app.use(
      '/health/ready',
      defineEventHandler(async (event: H3Event) => {
        const { status, body } = await this._computeReadiness()
        setResponseStatus(event, status)
        return body
      }),
    )
  }

  private _handleHealthRequest(method: string, path: string): Response | Promise<Response> | null {
    if (method !== 'GET') return null

    if (path === '/health/live') {
      return Response.json({
        status: 'alive',
        uptime_ms: Date.now() - this._startedAt,
      })
    }

    if (path === '/health/ready') {
      return this._computeReadiness().then(({ status, body }) => Response.json(body, { status }))
    }

    return null
  }

  /**
   * BC-F22 — Run all configured readiness probes with a per-probe timeout.
   * Absent probes are simply omitted from the checks object (never reported
   * as failures). Returns HTTP 200 when every probe passes, 503 otherwise.
   */
  private async _computeReadiness(): Promise<{
    status: number
    body: { status: string; uptime_ms: number; checks: Record<string, 'ok' | 'error'> }
  }> {
    const probes = this._options?.readinessProbes ?? {}
    const timeoutMs = this._options?.readinessTimeoutMs ?? 500
    const checks: Record<string, 'ok' | 'error'> = {}

    const entries = Object.entries(probes)
    await Promise.all(
      entries.map(async ([name, probe]) => {
        try {
          const result = await Promise.race([
            probe(),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
          ])
          checks[name] = result === true ? 'ok' : 'error'
        } catch {
          checks[name] = 'error'
        }
      }),
    )

    const allOk = Object.values(checks).every((v) => v === 'ok')
    return {
      status: allOk ? 200 : 503,
      body: {
        status: allOk ? 'ready' : 'not_ready',
        uptime_ms: Date.now() - this._startedAt,
        checks,
      },
    }
  }

  // Internal route registry for handleRequest() (testing)
  private _internalRoutes: Array<{
    method: string
    pattern: RegExp
    paramNames: string[]
    handler: (req: Request) => Promise<Response> | Response
    options?: RouteOptions
  }> = []

  private _registerInternalRoute(
    method: string,
    path: string,
    handler: (req: Request) => Promise<Response> | Response,
    options?: RouteOptions,
  ): void {
    const paramNames: string[] = []
    // Convert an H3-style path to a regex. Supports:
    //   :param  — single segment param (captured, named)
    //   **      — catch-all wildcard matching the rest of the path (unnamed)
    //   **:name — catch-all wildcard with a capture name
    // `**` must be escaped first — before the regex engine sees `*` as a quantifier —
    // otherwise paths like '/api/posthog/**' throw "Nothing to repeat".
    const regexStr = path
      // Catch-all with named capture: **:path → ([^]*) and remember the name
      .replace(/\*\*:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name) => {
        paramNames.push(name)
        return '([^]*)'
      })
      // Bare catch-all: ** → .*
      .replace(/\*\*/g, '.*')
      // Single segment param: :name → ([^/]+)
      .replace(/:([^/]+)/g, (_match, paramName) => {
        paramNames.push(paramName)
        return '([^/]+)'
      })
    this._internalRoutes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${regexStr}$`),
      paramNames,
      handler,
      options,
    })
  }

  private async _internalHandleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url, 'http://localhost')
    const method = req.method.toUpperCase()
    const pathname = url.pathname

    for (const route of this._internalRoutes) {
      if (route.method !== method) continue
      const match = pathname.match(route.pattern)
      if (match) {
        try {
          // Run pipeline steps on the request
          const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()

          // Step 5 -- Body parsing
          let body: unknown
          if (method !== 'GET' && method !== 'HEAD') {
            body = await req
              .clone()
              .json()
              .catch(() => undefined)
          }

          // Step 6 -- Auth (Bearer, API key, cookie)
          let authContext: AuthContext | null = null

          // 1. Bearer token
          if (this._authVerifier) {
            const authHeader = req.headers.get('authorization')
            const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
            if (token) {
              authContext = await this._authVerifier(token)
            }
          }

          // 2. API key
          if (!authContext && this._authVerifier) {
            const apiKey = req.headers.get('x-api-key')
            if (apiKey) {
              authContext = await this._authVerifier(apiKey)
            }
          }

          // 3. Cookie session
          if (!authContext && this._sessionVerifier) {
            const cookieHeader = req.headers.get('cookie')
            if (cookieHeader) {
              const cookies = parseCookies(cookieHeader)
              const sessionId = cookies['manta.sid'] ?? cookies.session
              if (sessionId) {
                authContext = await this._sessionVerifier(sessionId)
              }
            }
          }

          if (
            (this._authVerifier || this._sessionVerifier) &&
            requiresAuthentication(pathname, this._contextAuthRules) &&
            !authContext
          ) {
            throw new MantaError('UNAUTHORIZED', 'Authentication required')
          }

          // V2: verify actor_type matches context (or delegate to custom middleware)
          if (this._contextAuthRules.length > 0) {
            for (const rule of this._contextAuthRules) {
              if (pathname.startsWith(rule.prefix) && !rule.publicPaths.has(pathname)) {
                if (rule.customMiddleware) {
                  const headers: Record<string, string | string[] | undefined> = {}
                  for (const [k, v] of req.headers) headers[k] = v
                  authContext = await rule.customMiddleware({ method, url: pathname, headers }, authContext)
                } else if (authContext && authContext.type !== rule.actorType) {
                  throw new MantaError('FORBIDDEN', `Actor type "${authContext.type}" cannot access ${rule.prefix}`)
                }
                break
              }
            }
          }

          // Step 8 -- Validation
          if (route.options?.bodySchema && body !== undefined) {
            try {
              body = route.options.bodySchema.parse(body)
            } catch (err) {
              const issues = (err as { issues?: Array<{ path: (string | number)[]; message: string }> }).issues ?? []
              const details = issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
              const detail = details.map((d) => `${d.path}: ${d.message}`).join(', ')
              throw new MantaError('INVALID_DATA', detail ? `Validation failed: ${detail}` : 'Validation failed')
            }
          }

          // Step 10 -- RBAC
          if (this._rbacEnabled && pathname.startsWith('/api/admin') && !authContext) {
            throw new MantaError('FORBIDDEN', 'Access denied')
          }

          // Build enriched request — clone original to preserve raw body (gzip, binary, etc.)
          const enrichedReq = req.clone()
          Object.defineProperty(enrichedReq, 'validatedBody', { value: body, enumerable: true })
          Object.defineProperty(enrichedReq, 'requestId', { value: requestId, enumerable: true })
          if (authContext) {
            Object.defineProperty(enrichedReq, 'authContext', { value: authContext, enumerable: true })
          }

          // Extract params
          const params: Record<string, string> = {}
          for (let i = 0; i < route.paramNames.length; i++) {
            params[route.paramNames[i]] = decodeURIComponent(match[i + 1] ?? '')
          }
          Object.defineProperty(enrichedReq, 'params', { value: params, enumerable: true })

          return await route.handler(enrichedReq)
        } catch (error) {
          const { status, body } = mapErrorToResponse(error, this._isDev)
          return new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }
    }

    return new Response(JSON.stringify({ type: 'NOT_FOUND', message: 'Route not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

/** Parse a Cookie header string into key-value pairs. */
function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key) cookies[key.trim()] = rest.join('=').trim()
  }
  return cookies
}
