import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useDashboardContext } from '../context'
import type { DataComponent, PageSpec } from '../pages/types'

export interface PageContext {
  pageId: string
  route: string
  composition: { main: string[]; sidebar?: string[] }
  components: Record<string, { id: string; type: string; props: Record<string, unknown> }>
}

/**
 * Returns the current page context for the AI to know what's on screen.
 * Matches the current URL to a page spec, then resolves all component definitions.
 */
export function usePageContext(
  allPages?: Record<string, PageSpec> | null,
  allComponents?: Record<string, DataComponent> | null,
): PageContext | null {
  const location = useLocation()
  const { overrideStore } = useDashboardContext()

  return useMemo(() => {
    const pathname = location.pathname
    // Merge provided pages/components with custom pages/components from overrideStore
    const customPages = overrideStore.getCustomPages()
    const customComponents = overrideStore.getCustomComponents()
    const pages = { ...(allPages || {}), ...customPages }
    const components = { ...(allComponents || {}), ...customComponents }

    // Find the matching page spec by route pattern
    let matchedSpec: PageSpec | null = null
    for (const spec of Object.values(pages)) {
      if (!spec.route) continue
      if (matchRoute(spec.route, pathname)) {
        matchedSpec = spec
        break
      }
    }

    if (!matchedSpec) return null

    // Check for runtime overrides on this page
    const runtime = overrideStore.getOverrides()
    const pageOverride = runtime.pages[matchedSpec.id]
    const effectiveSpec = pageOverride ? { ...matchedSpec, ...pageOverride } : matchedSpec

    // Collect all component IDs referenced by this page
    const mainRefs = asStringArray(effectiveSpec.main)
    const sidebarRefs = effectiveSpec.sidebar ? asStringArray(effectiveSpec.sidebar) : undefined
    const allRefs = [...mainRefs, ...(sidebarRefs || [])]

    // Resolve component definitions (runtime overrides > defaults)
    const resolvedComponents: Record<string, { id: string; type: string; props: Record<string, unknown> }> = {}
    for (const ref of allRefs) {
      const runtimeComp = runtime.components[ref]
      const defaultComp = components[ref]
      const comp = runtimeComp || defaultComp
      if (comp) {
        resolvedComponents[ref] = {
          id: comp.id,
          type: comp.type,
          props: comp.props as Record<string, unknown>,
        }
      }
    }

    return {
      pageId: matchedSpec.id,
      route: pathname,
      composition: { main: mainRefs, sidebar: sidebarRefs },
      components: resolvedComponents,
    }
  }, [location.pathname, allPages, allComponents, overrideStore])
}

function asStringArray(arr: Array<string | { ref: string }>): string[] {
  return arr.map((el) => (typeof el === 'string' ? el : el.ref))
}

/**
 * Simple route pattern matcher: /products/:id matches /products/prod_123
 */
function matchRoute(pattern: string, pathname: string): boolean {
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = pathname.split('/').filter(Boolean)

  if (patternParts.length !== pathParts.length) return false

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) continue
    if (patternParts[i] !== pathParts[i]) return false
  }

  return true
}
