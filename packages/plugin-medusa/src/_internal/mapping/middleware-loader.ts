// Middleware loader — discovers and maps Medusa route middlewares.
//
// Medusa defines middlewares in:
//   @medusajs/medusa/dist/api/middlewares.js
//
// The file exports a defineMiddlewares({ routes: [...] }) with per-route middleware configs.
// Each route middleware has: { matcher, method, middlewares[] }

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { addAlert } from '../alerts'

const require = createRequire(import.meta.url)

export interface MiddlewareMapping {
  /** URL pattern matcher (e.g. '/admin/products', '/admin/products/:id') */
  matcher: string
  /** HTTP method filter (optional, applies to all if not set) */
  method?: string
  /** Middleware functions to apply before the handler */
  // biome-ignore lint/suspicious/noExplicitAny: Medusa middleware
  middlewares: Array<(req: any, res: any, next: () => void) => void | Promise<void>>
}

export interface MiddlewareDiscoveryResult {
  mappings: MiddlewareMapping[]
  total: number
}

/**
 * Discover route-level middlewares from @medusajs/medusa.
 *
 * Loads the middlewares config file and extracts per-route middleware mappings.
 * Returns empty if file not found (graceful degradation).
 */
export function discoverMiddlewares(): MiddlewareDiscoveryResult {
  try {
    const medusaPkg = require.resolve('@medusajs/medusa/package.json')
    const medusaDir = dirname(medusaPkg)
    const middlewaresPath = join(medusaDir, 'dist', 'api', 'middlewares.js')

    const mod = require(middlewaresPath)
    const config = mod.default ?? mod

    if (!config?.routes && !Array.isArray(config)) {
      return { mappings: [], total: 0 }
    }

    const routes = config.routes ?? config
    const mappings: MiddlewareMapping[] = []

    for (const route of routes) {
      if (!route.matcher) continue

      const middlewares = Array.isArray(route.middlewares)
        ? route.middlewares.filter((mw: unknown) => typeof mw === 'function')
        : []

      if (middlewares.length === 0) continue

      mappings.push({
        matcher: route.matcher,
        method: route.method,
        middlewares,
      })
    }

    return { mappings, total: mappings.length }
  } catch (err) {
    addAlert({
      level: 'warn',
      layer: 'route',
      artifact: 'middlewares.js',
      message: `Could not load middleware config: ${(err as Error).message}`,
    })
    return { mappings: [], total: 0 }
  }
}

/**
 * Find middlewares that match a given route path and method.
 */
export function findMatchingMiddlewares(
  mappings: MiddlewareMapping[],
  path: string,
  method: string,
): MiddlewareMapping[] {
  return mappings.filter((m) => {
    // Method filter
    if (m.method && m.method.toUpperCase() !== method.toUpperCase()) return false

    // Simple pattern matching — Medusa uses glob-like patterns
    const pattern = m.matcher.replace(/\*/g, '.*').replace(/:([^/]+)/g, '[^/]+')
    return new RegExp(`^${pattern}$`).test(path) || path.startsWith(m.matcher.replace(/\*/g, ''))
  })
}
