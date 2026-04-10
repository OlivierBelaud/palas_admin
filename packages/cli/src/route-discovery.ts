// SPEC-039 — File-system route discovery
// Scans src/api/ and maps file paths to HTTP routes

import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

export interface DiscoveredRoute {
  /** HTTP method (GET, POST, PUT, DELETE, PATCH) */
  method: string
  /** URL path (e.g. /admin/products/:id) */
  path: string
  /** Absolute file path to the route module */
  file: string
  /** Export name in the module (e.g. 'GET', 'POST') */
  exportName: string
  /** Optional Zod schema for body validation (from VALIDATION export) */
  bodySchema?: unknown
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'])

/**
 * Discover routes from src/api/ directory.
 *
 * Convention:
 * - src/api/admin/products/route.ts → /api/admin/products
 * - src/api/admin/products/[id]/route.ts → /api/admin/products/:id
 * - Exported named functions matching HTTP methods become handlers
 * - All routes are prefixed with /api/
 */
export async function discoverRoutes(cwd: string): Promise<DiscoveredRoute[]> {
  const apiDir = resolve(cwd, 'src', 'api')

  if (!existsSync(apiDir)) {
    return []
  }

  const routeFiles = findRouteFiles(apiDir)
  const routes: DiscoveredRoute[] = []

  for (const file of routeFiles) {
    // Derive URL path from file path
    const relPath = relative(apiDir, dirname(file))
    const urlPath =
      '/api/' +
      relPath
        .split('/')
        .map((segment) => {
          // [...path] → ** (H3/Nitro catch-all syntax)
          if (segment.startsWith('[...') && segment.endsWith(']')) {
            return '**'
          }
          // [id] → :id
          if (segment.startsWith('[') && segment.endsWith(']')) {
            return `:${segment.slice(1, -1)}`
          }
          return segment
        })
        .join('/')

    // Import the module to discover exported methods
    const mod = await import(`${file}?t=${Date.now()}`)

    // Check for VALIDATION export: { POST: zodSchema, PUT: zodSchema, ... }
    const validation = mod.VALIDATION as Record<string, unknown> | undefined

    for (const exportName of Object.keys(mod)) {
      if (HTTP_METHODS.has(exportName) && typeof mod[exportName] === 'function') {
        routes.push({
          method: exportName,
          path: urlPath,
          file,
          exportName,
          bodySchema: validation?.[exportName],
        })
      }
    }
  }

  return routes
}

/**
 * Recursively find all route.ts files in a directory.
 */
function findRouteFiles(dir: string): string[] {
  const files: string[] = []

  if (!existsSync(dir)) return files

  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      files.push(...findRouteFiles(fullPath))
    } else if (entry === 'route.ts' || entry === 'route.js') {
      files.push(fullPath)
    }
  }

  return files
}
