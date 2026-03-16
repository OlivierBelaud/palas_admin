// SPEC-140 — Strict mode validation
// Disables implicit conventions and enforces explicit declarations

import { MantaError } from '../errors/manta-error'

export interface StrictModeContext {
  strict: boolean
}

export interface RouteConflictInfo {
  path: string
  method: string
  source1: string
  source2: string
}

export interface LinkLocation {
  id: string
  path: string
}

// SM-01 -- Route conflict detection
export function checkRouteConflicts(
  routes: Array<{ method: string; path: string; source: string }>,
  strict: boolean,
): { conflicts: RouteConflictInfo[]; warnings: string[] } {
  const conflicts: RouteConflictInfo[] = []
  const warnings: string[] = []
  const seen = new Map<string, string>() // "METHOD /path" -> source

  for (const route of routes) {
    const key = `${route.method} ${route.path}`
    const existing = seen.get(key)
    if (existing) {
      const conflict: RouteConflictInfo = {
        path: route.path,
        method: route.method,
        source1: existing,
        source2: route.source,
      }
      conflicts.push(conflict)

      if (strict) {
        throw new MantaError(
          'INVALID_STATE',
          `Route conflict: ${key} registered by both "${existing}" and "${route.source}". Strict mode forbids route conflicts.`,
        )
      } else {
        warnings.push(`Route conflict: ${key} — "${route.source}" overrides "${existing}" (last-wins)`)
      }
    }
    seen.set(key, route.source) // last-wins in normal mode
  }

  return { conflicts, warnings }
}

// SM-02 -- dangerouslyUnboundedRelations
export function checkUnboundedRelations(
  opts: { dangerouslyUnboundedRelations?: boolean },
  strict: boolean,
): { allowed: boolean; warning?: string } {
  if (opts.dangerouslyUnboundedRelations) {
    if (strict) {
      throw new MantaError(
        'INVALID_STATE',
        'dangerouslyUnboundedRelations is forbidden in strict mode',
      )
    }
    return { allowed: true, warning: 'dangerouslyUnboundedRelations is enabled — nested relations are unbounded' }
  }
  return { allowed: false }
}

// SM-03 -- Entity threshold
export function getEntityThreshold(strict: boolean, configuredMax?: number): number {
  if (configuredMax !== undefined) return configuredMax
  return strict ? 5000 : 10000
}

// SM-04 -- Link outside src/links/
export function checkLinkLocations(
  links: LinkLocation[],
  strict: boolean,
): { valid: LinkLocation[]; invalid: LinkLocation[]; warnings: string[] } {
  const valid: LinkLocation[] = []
  const invalid: LinkLocation[] = []
  const warnings: string[] = []

  for (const link of links) {
    // Links must be in src/links/ directory
    const normalized = link.path.replace(/\\/g, '/')
    if (normalized.includes('/src/links/') || normalized.includes('/links/')) {
      valid.push(link)
    } else {
      invalid.push(link)
      if (strict) {
        throw new MantaError(
          'INVALID_STATE',
          `Link "${link.id}" at "${link.path}" is outside src/links/. Strict mode requires all links in src/links/.`,
        )
      } else {
        warnings.push(`Link "${link.id}" at "${link.path}" is outside src/links/ — silently ignored`)
      }
    }
  }

  return { valid, invalid, warnings }
}

// SM-05 -- Auto-discovery vs manifest
export function checkAutoDiscovery(
  strict: boolean,
  hasManifest: boolean,
): { useAutoDiscovery: boolean; warning?: string } {
  if (strict && !hasManifest) {
    throw new MantaError(
      'INVALID_STATE',
      'Strict mode requires a build manifest. Auto-discovery is disabled in strict mode. Run `manta build` first.',
    )
  }
  return { useAutoDiscovery: !strict }
}

// SM-06 -- Event name auto-generation
export function checkEventNameAutoGeneration(
  strict: boolean,
  hasExplicitEvents: boolean,
): { autoGenerate: boolean; warning?: string } {
  if (strict && !hasExplicitEvents) {
    throw new MantaError(
      'INVALID_STATE',
      'Strict mode requires explicit event name declarations. Auto-generation is disabled.',
    )
  }
  return { autoGenerate: !strict }
}
