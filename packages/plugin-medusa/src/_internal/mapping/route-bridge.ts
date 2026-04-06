// Route bridge — loads Medusa route handlers and registers them in MantaApp.
//
// Strategy:
// 1. Load each Medusa route.js file via require()
// 2. Extract HTTP method exports (GET, POST, PUT, DELETE, PATCH)
// 3. Wrap each handler: Medusa Express (req,res) → Manta (MantaRequest) → Response
// 4. Register in the H3 adapter
//
// Medusa route handlers have this signature:
//   export async function GET(req: MedusaRequest, res: MedusaResponse) {
//     const query = req.scope.resolve('query')
//     const { result, count } = await query.graph({ entity, fields, filters })
//     res.json({ entities: result, count })
//   }
//
// They depend on:
// - req.scope.resolve(key) — container resolution
// - req.auth_context — authentication
// - req.validatedBody — validated body
// - req.validatedQuery — validated query params
// - req.filterableFields — query filters
// - req.remoteQueryConfig — fields/pagination config
// - req.listConfig — list configuration (select, relations, take, skip, order)
// - req.params — URL params
// - res.json(data) / res.status(code).json(data) — response

import type { MantaApp } from '@manta/core'
import { addAlert } from '../alerts'
import type { DiscoveredRoute } from '../discovery/routes'
import { findMatchingMiddlewares, type MiddlewareMapping } from './middleware-loader'
import { createRemoteQueryCallable, MedusaQueryAdapter, type RemoteQueryFunction } from './query-adapter'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const

export interface RouteRegistrationResult {
  registered: number
  skipped: number
  failed: number
  errors: string[]
}

export interface RouteHandlerEntry {
  method: string
  path: string
  // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
  handler: (req: any) => Promise<Response>
}

// ====================================================================
// MedusaScope — centralizes all container resolution for Medusa routes
// ====================================================================

/**
 * Scope proxy that Medusa routes and workflows use via `req.scope.resolve(key)`.
 *
 * Resolves:
 * - 'query' → MedusaQueryAdapter (with graph() returning { data, metadata })
 * - 'remoteQuery' → callable remoteQuery function
 * - 'link' / 'remoteLink' → LinkService instance
 * - Module names ('product', 'order', etc.) → module services from app.modules
 * - 'xxxModuleService' → alias to module service
 * - 'configModule' → project config (jwt_secret, cookie_secret, database_url)
 * - 'logger' → app.infra.logger
 * - Infra ports → app.resolve(key)
 */
export class MedusaScope {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic app
  private app: MantaApp<any>
  private queryAdapter: MedusaQueryAdapter
  private remoteQuery: RemoteQueryFunction
  // biome-ignore lint/suspicious/noExplicitAny: LinkService is from plugin-medusa
  private linkService: any
  // biome-ignore lint/suspicious/noExplicitAny: extra registrations
  private extras: Map<string, any>

  constructor(
    // biome-ignore lint/suspicious/noExplicitAny: dynamic app
    app: MantaApp<any>,
    queryAdapter: MedusaQueryAdapter,
    remoteQuery: RemoteQueryFunction,
    // biome-ignore lint/suspicious/noExplicitAny: LinkService
    linkService: any,
    // biome-ignore lint/suspicious/noExplicitAny: extra overrides
    extras?: Map<string, any>,
  ) {
    this.app = app
    this.queryAdapter = queryAdapter
    this.remoteQuery = remoteQuery
    this.linkService = linkService
    this.extras = extras ?? new Map()
  }

  resolve<T = unknown>(key: string): T {
    // 1. Check extras first (overrides)
    if (this.extras.has(key)) return this.extras.get(key) as T

    // 2. Well-known Medusa keys
    if (key === 'query') return this.queryAdapter as T
    if (key === 'remoteQuery') return this.remoteQuery as T
    if (key === 'link' || key === 'remoteLink') return this.linkService as T
    if (key === 'logger') return this.app.infra.logger as T

    if (key === 'configModule') {
      return {
        projectConfig: {
          jwt_secret: process.env.JWT_SECRET ?? 'manta-dev-secret',
          cookie_secret: process.env.COOKIE_SECRET ?? 'manta-dev-cookie',
          database_url: process.env.DATABASE_URL ?? '',
          http: { jwtSecret: process.env.JWT_SECRET ?? 'manta-dev-secret' },
        },
      } as T
    }

    // 3. Module service by name (e.g. 'product', 'order')
    // biome-ignore lint/suspicious/noExplicitAny: dynamic modules
    const modules = this.app.modules as Record<string, any>
    if (modules[key]) return modules[key] as T

    // 4. Module service by 'xxxModuleService' alias
    if (key.endsWith('ModuleService')) {
      const moduleName = key.replace('ModuleService', '')
      if (modules[moduleName]) return modules[moduleName] as T
      // Try kebab-case
      const kebab = moduleName
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '')
      if (modules[kebab]) return modules[kebab] as T
    }

    // 5. Try camelCase → kebab-case (salesChannel → sales-channel)
    const kebab = key
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, '')
    if (kebab !== key && modules[kebab]) return modules[kebab] as T

    // 6. Try app.resolve() for infra and other registered keys
    try {
      return this.app.resolve<T>(key)
    } catch {
      return undefined as T
    }
  }

  /** Register an extra key-value pair for scope resolution. */
  register(key: string, value: unknown): void {
    this.extras.set(key, value)
  }

  /** Workflows call container.createScope() — return self (no real isolation needed in bridge). */
  createScope(): MedusaScope {
    return this
  }
}

// ====================================================================
// Fake Response builder
// ====================================================================

/**
 * Build a fake MedusaResponse that captures json/status calls into a Response.
 */
function createFakeResponse(): {
  // biome-ignore lint/suspicious/noExplicitAny: Medusa res
  res: any
  getResponse: () => Response
} {
  let statusCode = 200
  // biome-ignore lint/suspicious/noExplicitAny: captured body
  let body: any = null
  const headers = new Headers({ 'content-type': 'application/json' })

  // biome-ignore lint/suspicious/noExplicitAny: Medusa res proxy
  const res: any = {
    status(code: number) {
      statusCode = code
      return res
    },
    // biome-ignore lint/suspicious/noExplicitAny: Medusa json body
    json(data: any) {
      body = data
      return res
    },
    // biome-ignore lint/suspicious/noExplicitAny: Medusa send
    send(data: any) {
      body = data
      return res
    },
    // biome-ignore lint/suspicious/noExplicitAny: Medusa header
    set(key: string, value: any) {
      headers.set(key, String(value))
      return res
    },
    setHeader(key: string, value: string) {
      headers.set(key, value)
      return res
    },
    end() {
      return res
    },
    // Express redirect compat
    redirect(urlOrStatus: string | number, url?: string) {
      if (typeof urlOrStatus === 'number') {
        statusCode = urlOrStatus
        headers.set('location', url ?? '/')
      } else {
        statusCode = 302
        headers.set('location', urlOrStatus)
      }
      return res
    },
    // Express cookie compat
    // biome-ignore lint/suspicious/noExplicitAny: Express cookie options
    cookie(_name: string, _value: string, _opts?: any) {
      return res
    },
    // Express compat
    headersSent: false,
    statusCode: 200,
  }

  // Make statusCode getter reflect the set value
  Object.defineProperty(res, 'statusCode', {
    get: () => statusCode,
    set: (v: number) => {
      statusCode = v
    },
  })

  const getResponse = (): Response => {
    // Handle redirect
    if (statusCode >= 300 && statusCode < 400 && headers.has('location')) {
      return new Response(null, { status: statusCode, headers })
    }
    const responseBody = body !== null ? JSON.stringify(body) : ''
    return new Response(responseBody, {
      status: statusCode,
      headers,
    })
  }

  return { res, getResponse }
}

// ====================================================================
// Fake Request builder
// ====================================================================

/**
 * Build a fake MedusaRequest from a MantaRequest.
 */
function createFakeRequest(mantaReq: Request, scope: MedusaScope): Record<string, unknown> {
  // biome-ignore lint/suspicious/noExplicitAny: MantaRequest enriched
  const mReq = mantaReq as any

  // Parse URL for query params
  const url = new URL(mantaReq.url, 'http://localhost')
  const queryParams: Record<string, string> = {}
  for (const [key, value] of url.searchParams) {
    queryParams[key] = value
  }

  // Build auth_context from MantaRequest
  const authContext = mReq.authContext
    ? {
        actor_id: mReq.authContext.actor_id,
        actor_type: mReq.authContext.actor_type,
        auth_identity_id: mReq.authContext.auth_identity_id,
        app_metadata: mReq.authContext.app_metadata ?? {},
        scope: mReq.authContext.scope,
        session_id: mReq.authContext.session_id,
      }
    : null

  return {
    // Standard request properties
    method: mantaReq.method,
    url: mantaReq.url,
    path: url.pathname,
    headers: Object.fromEntries(mantaReq.headers.entries()),
    hostname: url.hostname,
    protocol: url.protocol.replace(':', ''),
    ip: '127.0.0.1',

    // Medusa-specific properties — scope is the real MedusaScope
    scope,
    params: mReq.params ?? {},
    body: mReq.validatedBody ?? mReq.body ?? {},
    validatedBody: mReq.validatedBody ?? mReq.body ?? {},
    validatedQuery: queryParams,
    query: queryParams,
    filterableFields: {},
    listConfig: {
      select: [],
      relations: [],
      take: 20,
      skip: 0,
      order: {},
    },
    remoteQueryConfig: {
      fields: [],
      pagination: { take: 20, skip: 0, order: {} },
    },
    queryConfig: {},
    auth_context: authContext,

    // Enrichments
    requestId: mReq.requestId ?? '',
  }
}

// ====================================================================
// Middleware runner
// ====================================================================

/**
 * Apply Medusa route middlewares to a request.
 * Runs the middleware chain (validate body, validate query, auth, etc.)
 * before the actual handler.
 */
export async function applyMiddlewares(
  // biome-ignore lint/suspicious/noExplicitAny: Medusa middleware array
  middlewares: Array<(req: any, res: any, next: (err?: any) => void) => void | Promise<void>>,
  // biome-ignore lint/suspicious/noExplicitAny: fake request
  req: Record<string, unknown>,
  // biome-ignore lint/suspicious/noExplicitAny: fake response
  res?: any,
): Promise<void> {
  const fakeRes = res ?? {}
  for (const mw of middlewares) {
    await new Promise<void>((resolve, reject) => {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: Express next callback
        const result = mw(req, fakeRes, ((err?: any) => {
          if (err) reject(err)
          else resolve()
        }) as () => void)
        if (result instanceof Promise) result.catch(reject)
      } catch (err) {
        reject(err)
      }
    })
  }
}

// ====================================================================
// Route handler wrapper
// ====================================================================

export interface WrapOptions {
  scope: MedusaScope
  // biome-ignore lint/suspicious/noExplicitAny: Medusa middleware functions
  middlewares?: Array<(req: any, res: any, next: (err?: any) => void) => void | Promise<void>>
}

/**
 * Wrap a Medusa Express-style route handler into a Manta Response handler.
 *
 * Medusa: async (req, res) => { res.json(data) }
 * Manta:  async (req) => Response
 *
 * When `options.middlewares` is provided, they are executed before the handler
 * to populate req.queryConfig, req.filterableFields, req.listConfig, etc.
 */
export function wrapMedusaRouteHandler(
  // biome-ignore lint/suspicious/noExplicitAny: Medusa handler
  medusaHandler: (req: any, res: any) => Promise<void>,
  // biome-ignore lint/suspicious/noExplicitAny: dynamic app
  app: MantaApp<any>,
  options?: WrapOptions,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    // Use provided scope or create a minimal fallback
    const scope = options?.scope ?? createFallbackScope(app)
    const fakeReq = createFakeRequest(req, scope)
    const { res, getResponse } = createFakeResponse()

    try {
      // Run middlewares before handler (populates queryConfig, filterableFields, etc.)
      if (options?.middlewares && options.middlewares.length > 0) {
        await applyMiddlewares(options.middlewares, fakeReq, res)
      }

      await medusaHandler(fakeReq, res)
      return getResponse()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = extractStatusCode(error) ?? 500
      return new Response(JSON.stringify({ type: 'UNEXPECTED_STATE', message }), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    }
  }
}

// ====================================================================
// Route loading
// ====================================================================

/**
 * Load a single Medusa route file and extract handler entries.
 * When middlewareMappings is provided, each method gets only the middlewares
 * that match that specific method (not all methods).
 */
export function loadRouteHandlers(
  route: DiscoveredRoute,
  // biome-ignore lint/suspicious/noExplicitAny: dynamic app
  app: MantaApp<any>,
  options?: WrapOptions,
  middlewareMappings?: MiddlewareMapping[],
): RouteHandlerEntry[] {
  const entries: RouteHandlerEntry[] = []

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createRequire } = require('node:module')
    const req = createRequire(import.meta.url)
    const mod = req(route.filePath)

    for (const method of HTTP_METHODS) {
      if (typeof mod[method] === 'function') {
        // Find middlewares specific to this method
        // Skip validateBody and validateQuery middlewares — they are Express-coupled
        // and crash when req doesn't have Express-specific internals (req.get, req.is, etc.)
        // Instead, we let the handlers run directly with our MedusaScope.
        let methodMiddlewares = options?.middlewares
        if (middlewareMappings && !options?.middlewares) {
          const matching = findMatchingMiddlewares(middlewareMappings, route.path, method)
          const mws: typeof methodMiddlewares = []
          for (const m of matching) {
            for (const mw of m.middlewares) {
              // Skip validation middlewares — they depend on Express internals
              const name = mw.name || ''
              if (name === 'validateBody' || name === 'validateQuery') continue
              mws!.push(mw)
            }
          }
          methodMiddlewares = mws!.length > 0 ? mws : undefined
        }

        const handlerOptions: WrapOptions = {
          scope: options?.scope ?? createFallbackScope(app),
          middlewares: methodMiddlewares,
        }
        const handler = wrapMedusaRouteHandler(mod[method], app, handlerOptions)
        entries.push({ method, path: route.path, handler })
      }
    }
  } catch (err) {
    addAlert({
      level: 'warn',
      layer: 'route',
      artifact: route.path,
      message: `Failed to load route handler: ${(err as Error).message}`,
    })
  }

  return entries
}

/**
 * Load and register all discovered Medusa routes.
 * Returns handler entries ready for H3 registration.
 *
 * When `scope` and `middlewareMappings` are provided, each route gets
 * the proper MedusaScope and matching middlewares injected.
 */
export function bridgeAllRoutes(
  routes: DiscoveredRoute[],
  // biome-ignore lint/suspicious/noExplicitAny: dynamic app
  app: MantaApp<any>,
  bridgeOptions?: {
    scope?: MedusaScope
    middlewareMappings?: MiddlewareMapping[]
  },
): { entries: RouteHandlerEntry[]; result: RouteRegistrationResult } {
  const entries: RouteHandlerEntry[] = []
  let registered = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []

  for (const route of routes) {
    try {
      const options: WrapOptions = {
        scope: bridgeOptions?.scope ?? createFallbackScope(app),
      }

      const handlers = loadRouteHandlers(route, app, options, bridgeOptions?.middlewareMappings)
      if (handlers.length === 0) {
        skipped++
        continue
      }
      entries.push(...handlers)
      registered += handlers.length
    } catch (err) {
      failed++
      errors.push(`${route.path}: ${(err as Error).message}`)
    }
  }

  return {
    entries,
    result: { registered, skipped, failed, errors },
  }
}

// ====================================================================
// Helpers
// ====================================================================

/**
 * Create a fallback scope for backward compatibility (when no MedusaScope provided).
 */
// biome-ignore lint/suspicious/noExplicitAny: dynamic app
function createFallbackScope(app: MantaApp<any>): MedusaScope {
  const queryAdapter = new MedusaQueryAdapter(app.modules)
  const remoteQuery = createRemoteQueryCallable(app.modules)
  return new MedusaScope(app, queryAdapter, remoteQuery, null)
}

/**
 * Extract HTTP status code from Medusa errors.
 */
function extractStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const err = error as Record<string, unknown>
  if (typeof err.status === 'number') return err.status
  if (typeof err.statusCode === 'number') return err.statusCode
  // MedusaError has type → status mapping
  const typeMap: Record<string, number> = {
    NOT_FOUND: 404,
    DUPLICATE_ERROR: 409,
    INVALID_DATA: 400,
    NOT_ALLOWED: 403,
    UNAUTHORIZED: 401,
    CONFLICT: 409,
  }
  if (typeof err.type === 'string' && typeMap[err.type]) return typeMap[err.type]
  return undefined
}
