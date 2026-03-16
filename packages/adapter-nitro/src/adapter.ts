// SPEC-039 — NitroAdapter implements IHttpPort

import {
  createApp, createRouter, defineEventHandler, toNodeListener,
  getMethod, setResponseHeader, setResponseStatus, send,
  type H3Event, type App, type Router,
} from 'h3'
import { createServer, type Server } from 'node:http'
import type { IHttpPort } from '@manta/core/ports'
import { MantaError } from '@manta/core/errors'
import {
  extractRequestId, setCorsHeaders, parseBody,
  mapErrorToResponse, ERROR_STATUS_MAP,
} from './pipeline'

export interface AuthContext {
  actor_type: string
  actor_id: string
  [key: string]: unknown
}

export type AuthVerifier = (token: string) => Promise<AuthContext | null>

export interface RouteOptions {
  bodySchema?: { parse: (data: unknown) => unknown }
}

export interface NitroAdapterOptions {
  port?: number
  host?: string
  isDev?: boolean
}

export class NitroAdapter implements IHttpPort {
  private _app: App
  private _router: Router
  private _server: Server | null = null
  private _startedAt: number
  private _isDev: boolean
  private _port: number
  private _host: string
  private _authVerifier: AuthVerifier | null = null
  private _rbacEnabled = false

  constructor(options: NitroAdapterOptions = {}) {
    this._app = createApp()
    this._router = createRouter()
    this._isDev = options.isDev ?? true
    this._port = options.port ?? 9000
    this._host = options.host ?? '0.0.0.0'
    this._startedAt = Date.now()

    this._registerHealthRoutes()
    this._app.use(this._router)
  }

  setAuthVerifier(verifier: AuthVerifier): void {
    this._authVerifier = verifier
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
      case 'get': this._router.get(path, h3Handler); break
      case 'post': this._router.post(path, h3Handler); break
      case 'put': this._router.put(path, h3Handler); break
      case 'delete': this._router.delete(path, h3Handler); break
      case 'patch': this._router.patch(path, h3Handler); break
      case 'options': this._router.options(path, h3Handler); break
      default: this._router.get(path, h3Handler); break
    }

    // Also store in internal registry for handleRequest()
    this._registerInternalRoute(method, path, handler, options)
  }

  async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url, 'http://localhost')
    const method = req.method.toUpperCase()
    const path = url.pathname

    const healthResponse = this._handleHealthRequest(method, path)
    if (healthResponse) return healthResponse

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

  get port(): number { return this._port }

  // The 12-step pipeline (SPEC-039)
  private async _runPipeline(
    event: H3Event,
    handler: (req: Request) => Promise<Response> | Response,
    options?: RouteOptions,
  ): Promise<void> {
    try {
      // Step 1 -- RequestID
      const requestId = extractRequestId(event)
      setResponseHeader(event, 'x-request-id', requestId)

      // Step 2 -- CORS
      const url = event.path ?? '/'
      setCorsHeaders(event, url)

      // OPTIONS preflight
      if (getMethod(event) === 'OPTIONS') {
        setResponseStatus(event, 204)
        return send(event, '')
      }

      // Step 3 -- Rate limit (no-op)

      // Step 4 -- Scope (no-op -- requires container)

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
      const reqInit: RequestInit = {
        method: getMethod(event),
        headers: { 'content-type': 'application/json', 'x-request-id': requestId },
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

      const responseBody = await response.text()
      return send(event, responseBody)
    } catch (error) {
      // Step 12 -- Error handler
      const { status, body } = mapErrorToResponse(error, this._isDev)
      setResponseStatus(event, status)
      setResponseHeader(event, 'content-type', 'application/json')
      return send(event, JSON.stringify(body))
    }
  }

  // Step 6 -- Auth: verify Bearer token
  private async _runAuthStep(event: H3Event, path: string): Promise<AuthContext | null> {
    const { getRequestHeader } = await import('h3')
    const authHeader = getRequestHeader(event, 'authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    let authContext: AuthContext | null = null
    if (token && this._authVerifier) {
      authContext = await this._authVerifier(token)
    }

    // /admin/* and /auth/* require auth
    if ((path.startsWith('/admin') || path.startsWith('/auth')) && !authContext) {
      throw new MantaError('UNAUTHORIZED', 'Authentication required')
    }

    return authContext
  }

  // Step 8 -- Validation
  private _runValidationStep(body: unknown, schema: { parse: (data: unknown) => unknown }): unknown {
    try {
      return schema.parse(body)
    } catch (err) {
      const issues = (err as { issues?: unknown[] }).issues
      throw new MantaError('INVALID_DATA', 'Validation failed')
    }
  }

  // Step 10 -- RBAC (basic namespace check)
  private _runRbacStep(path: string, authContext: AuthContext | null): void {
    // Basic RBAC: admin routes require authenticated actor
    // More advanced RBAC (role checks) would be implemented later
    if (path.startsWith('/admin') && !authContext) {
      throw new MantaError('FORBIDDEN', 'Access denied')
    }
  }

  // Health endpoints -- SPEC-072
  private _registerHealthRoutes(): void {
    this._app.use('/health/live', defineEventHandler(() => {
      return {
        status: 'alive',
        uptime_ms: Date.now() - this._startedAt,
      }
    }))

    this._app.use('/health/ready', defineEventHandler(() => {
      return {
        status: 'ready',
        uptime_ms: Date.now() - this._startedAt,
        checks: {},
      }
    }))
  }

  private _handleHealthRequest(method: string, path: string): Response | null {
    if (method !== 'GET') return null

    if (path === '/health/live') {
      return Response.json({
        status: 'alive',
        uptime_ms: Date.now() - this._startedAt,
      })
    }

    if (path === '/health/ready') {
      return Response.json({
        status: 'ready',
        uptime_ms: Date.now() - this._startedAt,
        checks: {},
      })
    }

    return null
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
    const regexStr = path.replace(/:([^/]+)/g, (_match, paramName) => {
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
          let body: unknown = undefined
          if (method !== 'GET' && method !== 'HEAD') {
            body = await req.clone().json().catch(() => undefined)
          }

          // Step 6 -- Auth
          let authContext: AuthContext | null = null
          if (this._authVerifier) {
            const authHeader = req.headers.get('authorization')
            const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

            if (token) {
              authContext = await this._authVerifier(token)
            }

            // /admin/* and /auth/* require auth
            if ((pathname.startsWith('/admin') || pathname.startsWith('/auth')) && !authContext) {
              throw new MantaError('UNAUTHORIZED', 'Authentication required')
            }
          }

          // Step 8 -- Validation
          if (route.options?.bodySchema && body !== undefined) {
            try {
              body = route.options.bodySchema.parse(body)
            } catch (err) {
              const issues = (err as { issues?: unknown[] }).issues
              throw new MantaError('INVALID_DATA', 'Validation failed')
            }
          }

          // Step 10 -- RBAC
          if (this._rbacEnabled && pathname.startsWith('/admin') && !authContext) {
            throw new MantaError('FORBIDDEN', 'Access denied')
          }

          // Build enriched request
          const enrichedReq = new Request(req.url, {
            method: req.method,
            headers: req.headers,
          })
          Object.defineProperty(enrichedReq, 'validatedBody', { value: body, enumerable: true })
          Object.defineProperty(enrichedReq, 'requestId', { value: requestId, enumerable: true })
          if (authContext) {
            Object.defineProperty(enrichedReq, 'authContext', { value: authContext, enumerable: true })
          }

          // Extract params
          const params: Record<string, string> = {}
          for (let i = 0; i < route.paramNames.length; i++) {
            params[route.paramNames[i]] = match[i + 1] ?? ''
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

    return new Response(
      JSON.stringify({ type: 'NOT_FOUND', message: 'Route not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
