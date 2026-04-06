import type { Resolver } from '../override/create-resolver'

export interface RouteEntry {
  path: string
  type: 'json-render' | 'react-import' | 'react-shell'
  pageId?: string
  componentKey?: string
}

export interface RouteResolution {
  type: 'json-render' | 'react-import' | 'react-shell'
  pageId?: string
  componentKey?: string
  params?: Record<string, string>
}

export function buildRouteMap(resolver: Resolver): RouteEntry[] {
  const allPages = resolver.getAllPageSpecs()
  const entries: RouteEntry[] = []
  const seenPaths = new Set<string>()

  for (const page of Object.values(allPages)) {
    if (!page.route) continue
    if (seenPaths.has(page.route)) continue
    seenPaths.add(page.route)

    entries.push({
      path: page.route,
      type: 'json-render',
      pageId: page.id,
    })
  }

  entries.sort((a, b) => {
    const aSegments = a.path.split('/').length
    const bSegments = b.path.split('/').length
    if (aSegments !== bSegments) return bSegments - aSegments
    const aParams = (a.path.match(/:/g) || []).length
    const bParams = (b.path.match(/:/g) || []).length
    return aParams - bParams
  })

  return entries
}

export function resolveRoute(path: string, routeMap: RouteEntry[]): RouteResolution | undefined {
  for (const entry of routeMap) {
    const params = matchPath(entry.path, path)
    if (params !== null) {
      return {
        type: entry.type,
        pageId: entry.pageId,
        componentKey: entry.componentKey,
        params: Object.keys(params).length > 0 ? params : undefined,
      }
    }
  }
  return undefined
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternSegments = pattern.split('/').filter(Boolean)
  const pathSegments = path.split('/').filter(Boolean)

  if (patternSegments.length !== pathSegments.length) return null

  const params: Record<string, string> = {}

  for (let i = 0; i < patternSegments.length; i++) {
    const pat = patternSegments[i]
    const seg = pathSegments[i]

    if (pat.startsWith(':')) {
      params[pat.slice(1)] = seg
    } else if (pat !== seg) {
      return null
    }
  }

  return params
}
