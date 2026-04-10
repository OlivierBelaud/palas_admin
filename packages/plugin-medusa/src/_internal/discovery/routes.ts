// Route discovery — scans @medusajs/medusa/dist/api/ for HTTP route handlers.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { addAlert } from '../alerts'

const require = createRequire(import.meta.url)

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const
type HttpMethod = (typeof HTTP_METHODS)[number]

export interface DiscoveredRoute {
  /** URL path (e.g. '/admin/products/:id') */
  path: string
  /** HTTP methods exported (e.g. ['GET', 'POST']) */
  methods: HttpMethod[]
  /** Namespace: 'admin', 'store', 'auth', or 'other' */
  namespace: 'admin' | 'store' | 'auth' | 'other'
  /** Absolute path to the route file */
  filePath: string
}

/**
 * Recursively find all route.js files in a directory.
 */
function findRouteFiles(dir: string): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results

  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      results.push(...findRouteFiles(fullPath))
    } else if (entry === 'route.js') {
      results.push(fullPath)
    }
  }
  return results
}

/**
 * Convert a filesystem path to a URL pattern.
 * e.g. 'admin/products/[id]/variants/route.js' → '/admin/products/:id/variants'
 */
function filePathToUrlPattern(filePath: string, apiDir: string): string {
  const rel = relative(apiDir, filePath)
    .replace(/route\.js$/, '')
    .replace(/\/$/, '')
    .replace(/\[([^\]]+)\]/g, ':$1')
  return `/${rel}`
}

/**
 * Detect which HTTP methods a route file exports.
 */
function detectMethods(filePath: string): HttpMethod[] {
  try {
    const mod = require(filePath)
    const methods: HttpMethod[] = []
    for (const method of HTTP_METHODS) {
      if (typeof mod[method] === 'function') {
        methods.push(method)
      }
    }
    return methods
  } catch (err) {
    addAlert({
      level: 'warn',
      layer: 'route',
      artifact: filePath,
      message: `Could not load route: ${(err as Error).message}`,
    })
    return []
  }
}

/**
 * Determine route namespace from URL path.
 */
function detectNamespace(path: string): 'admin' | 'store' | 'auth' | 'other' {
  if (path.startsWith('/admin')) return 'admin'
  if (path.startsWith('/store')) return 'store'
  if (path.startsWith('/auth')) return 'auth'
  return 'other'
}

/**
 * Discover all API routes from @medusajs/medusa.
 */
export function discoverRoutes(): DiscoveredRoute[] {
  let apiDir: string
  try {
    const medusaPkg = require.resolve('@medusajs/medusa/package.json')
    apiDir = join(dirname(medusaPkg), 'dist', 'api')
  } catch (err) {
    addAlert({
      level: 'error',
      layer: 'route',
      artifact: '@medusajs/medusa',
      message: `Could not resolve @medusajs/medusa: ${(err as Error).message}`,
    })
    return []
  }

  if (!existsSync(apiDir)) {
    addAlert({
      level: 'error',
      layer: 'route',
      artifact: apiDir,
      message: 'API directory not found',
    })
    return []
  }

  const routeFiles = findRouteFiles(apiDir)
  const discovered: DiscoveredRoute[] = []

  for (const filePath of routeFiles) {
    const path = filePathToUrlPattern(filePath, apiDir)
    const methods = detectMethods(filePath)
    const namespace = detectNamespace(path)

    if (methods.length === 0) {
      addAlert({
        level: 'warn',
        layer: 'route',
        artifact: path,
        message: 'Route file has no HTTP method exports',
      })
      continue
    }

    discovered.push({ path, methods, namespace, filePath })
  }

  return discovered
}

/**
 * Count total HTTP endpoints (route files * methods per file).
 */
export function countEndpoints(routes: DiscoveredRoute[]): number {
  return routes.reduce((sum, r) => sum + r.methods.length, 0)
}
