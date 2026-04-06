// SPEC-039 — H3 App factory
// Takes a bootstrapped Manta app, discovers routes, creates and returns the H3 app.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import type { createApp } from 'h3'

type App = ReturnType<typeof createApp>

import { H3Adapter } from './adapter'

// ── Route discovery ─────────────────────────────────────────────────

interface DiscoveredRoute {
  method: string
  path: string
  file: string
  exportName: string
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])

function findRouteFiles(dir: string): string[] {
  const files: string[] = []
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...findRouteFiles(fullPath))
    } else if (entry === 'route.ts' || entry === 'route.js') {
      files.push(fullPath)
    }
  }
  return files
}

async function discoverRoutes(
  cwd: string,
  importFn?: (path: string) => Promise<Record<string, unknown>>,
): Promise<DiscoveredRoute[]> {
  const apiDir = resolve(cwd, 'src', 'api')
  if (!existsSync(apiDir)) return []

  const routeFiles = findRouteFiles(apiDir)
  const routes: DiscoveredRoute[] = []

  const doImport = importFn ?? ((path: string) => import(`${path}?t=${Date.now()}`))

  for (const file of routeFiles) {
    const relPath = relative(apiDir, dirname(file))
    const urlPath =
      '/api/' +
      relPath
        .split('/')
        .map((seg) => (seg.startsWith('[') && seg.endsWith(']') ? `:${seg.slice(1, -1)}` : seg))
        .join('/')

    const mod = await doImport(file)
    for (const exportName of Object.keys(mod)) {
      if (HTTP_METHODS.has(exportName) && typeof mod[exportName] === 'function') {
        routes.push({ method: exportName, path: urlPath, file, exportName })
      }
    }
  }
  return routes
}

// ── Manta H3 App ────────────────────────────────────────────────────

/**
 * A pre-registered route handler.
 * Use this when routes are already imported (e.g. in Nitro where bundling handles imports).
 */
export interface RouteHandler {
  method: string
  path: string
  handler: (req: unknown) => Promise<Response> | Response
}

export interface MantaH3AppOptions {
  /** The MantaApp instance. Used for resolve() and injected into requests as req.app. */
  mantaApp?: { resolve: <T>(key: string) => T; workflows?: unknown; [key: string]: unknown }
  /** Working directory (for route discovery from src/api/). Omit if providing `routes`. */
  cwd?: string
  /** Custom import function for .ts files (e.g. jiti). Falls back to native import(). */
  importFn?: (path: string) => Promise<Record<string, unknown>>
  /** Pre-registered routes. If provided, skips filesystem discovery. */
  routes?: RouteHandler[]
  /** Dev mode (default: true) */
  isDev?: boolean
  /** Logger (optional, for route logging) */
  logger?: { info: (msg: string) => void; warn: (msg: string) => void }
}

export interface MantaH3App {
  /** The H3 App, ready to be mounted on any host */
  app: App
  /** The underlying H3Adapter instance */
  adapter: H3Adapter
  /** The discovered routes */
  routes: DiscoveredRoute[]
}

/**
 * Creates a fully configured Manta H3 app.
 *
 * This is the main entry point for adapter-h3. It:
 * 1. Creates an H3Adapter
 * 2. Discovers routes from src/api/
 * 3. Registers them on the adapter with scope injection
 * 4. Returns the H3 App ready to be mounted on any host (Nitro, standalone, etc.)
 *
 * ```ts
 * const app = appBuilder.build()
 * const { app: h3App } = await createMantaH3App({
 *   mantaApp: app,
 *   cwd,
 * })
 * // Mount h3App on Nitro, or listen directly
 * ```
 */
export async function createMantaH3App(options: MantaH3AppOptions): Promise<MantaH3App> {
  const { mantaApp, cwd, isDev = true, logger } = options

  if (!mantaApp) throw new Error('createMantaH3App requires mantaApp')

  const adapter = new H3Adapter({ port: 0, isDev })
  const scope = { resolve: <T>(key: string): T => mantaApp.resolve<T>(key) }

  // Either use pre-registered routes or discover from filesystem
  const routeHandlers: Array<{
    method: string
    path: string
    handler: (req: unknown) => Promise<Response> | Response
  }> = []

  if (options.routes) {
    // Pre-registered routes (e.g. from a Nitro plugin where modules are already bundled)
    routeHandlers.push(...options.routes)
  } else if (cwd) {
    // Discover routes from filesystem (standalone mode / CLI)
    const doImport = options.importFn ?? ((path: string) => import(`${path}?t=${Date.now()}`))
    const discovered = await discoverRoutes(cwd, doImport)
    for (const route of discovered) {
      const mod = await doImport(route.file)
      const handlerFn = mod[route.exportName] as (req: unknown) => Promise<Response> | Response
      routeHandlers.push({ method: route.method, path: route.path, handler: handlerFn })
    }
  }

  // Register all routes on the H3Adapter
  for (const route of routeHandlers) {
    adapter.registerRoute(route.method, route.path, async (req: Request) => {
      // Enrich the request with MantaApp, scope, query, workflows, params, validatedBody
      const mantaReq: Request & Record<string, unknown> = req as Request & Record<string, unknown>

      // Enrich request — only set properties not already defined by the pipeline
      if (!('scope' in mantaReq)) {
        Object.defineProperty(mantaReq, 'scope', { value: scope, enumerable: true, configurable: true })
      }

      // Inject MantaApp if provided
      if (options.mantaApp && !('app' in mantaReq)) {
        Object.defineProperty(mantaReq, 'app', { value: options.mantaApp, enumerable: true, configurable: true })
      }

      // Inject shortcuts: req.query and req.workflows
      if (options.mantaApp) {
        if (!('query' in mantaReq)) {
          try {
            const queryService = options.mantaApp.resolve('query')
            Object.defineProperty(mantaReq, 'query', { value: queryService, enumerable: true, configurable: true })
          } catch {
            // query service not registered — skip
          }
        }
        if (!('workflows' in mantaReq)) {
          Object.defineProperty(mantaReq, 'workflows', {
            value: options.mantaApp.workflows,
            enumerable: true,
            configurable: true,
          })
        }
      }

      // Extract path params (only if not already set)
      if (!('params' in mantaReq)) {
        const patternParts = route.path.split('/')
        const pathParts = new URL(req.url).pathname.split('/')
        const params: Record<string, string> = {}
        for (let i = 0; i < patternParts.length; i++) {
          if (patternParts[i].startsWith(':')) {
            params[patternParts[i].slice(1)] = pathParts[i] ?? ''
          }
        }
        Object.defineProperty(mantaReq, 'params', { value: params, enumerable: true, configurable: true })
      }

      // Parse body for mutation methods (only if not already set)
      if (!('validatedBody' in mantaReq) && ['POST', 'PUT', 'PATCH'].includes(route.method)) {
        try {
          const rawBody = await req
            .clone()
            .json()
            .catch(() => ({}))
          Object.defineProperty(mantaReq, 'validatedBody', { value: rawBody, enumerable: true, configurable: true })
        } catch {
          Object.defineProperty(mantaReq, 'validatedBody', { value: {}, enumerable: true, configurable: true })
        }
      }

      return route.handler(mantaReq)
    })

    logger?.info(`  ${route.method} ${route.path}`)
  }

  if (routeHandlers.length === 0) logger?.warn('No routes registered')

  return { app: adapter.getApp(), adapter, routes: routeHandlers.map((r) => ({ ...r, file: '', exportName: '' })) }
}
