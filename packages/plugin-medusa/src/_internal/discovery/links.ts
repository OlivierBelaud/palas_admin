// Link discovery — scans @medusajs/link-modules definitions for cross-module relationships.

import { createRequire } from 'node:module'
import { addAlert } from '../alerts'

const require = createRequire(import.meta.url)

export interface DiscoveredLink {
  /** Export name (e.g. 'CartPaymentCollection') */
  exportName: string
  /** Service name for the link */
  serviceName: string
  /** Whether this is a read-only FK link (vs read-write pivot table) */
  isReadOnly: boolean
  /** Primary keys of the link table */
  primaryKeys: string[]
  /** Database config (table name, etc.) */
  // biome-ignore lint/suspicious/noExplicitAny: Medusa link config
  databaseConfig: any
  /** Relationship definitions (read-write links) */
  // biome-ignore lint/suspicious/noExplicitAny: Medusa link config
  relationships: any[]
  /** Extends definitions (read-only links use this instead of relationships) */
  // biome-ignore lint/suspicious/noExplicitAny: Medusa link config
  extends: any[]
}

/**
 * Discover all link definitions from @medusajs/link-modules.
 */
export function discoverLinks(): DiscoveredLink[] {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic module inspection
  let definitions: Record<string, any>
  try {
    definitions = require('@medusajs/link-modules/dist/definitions/index.js')
  } catch (err) {
    addAlert({
      level: 'error',
      layer: 'link',
      artifact: '@medusajs/link-modules',
      message: `Could not load link definitions: ${(err as Error).message}`,
    })
    return []
  }

  const discovered: DiscoveredLink[] = []

  for (const [exportName, def] of Object.entries(definitions)) {
    if (!def || typeof def !== 'object' || !def.isLink) continue

    discovered.push({
      exportName,
      serviceName: def.serviceName || exportName,
      isReadOnly: !!def.isReadOnlyLink,
      primaryKeys: def.primaryKeys || [],
      databaseConfig: def.databaseConfig || null,
      relationships: def.relationships || [],
      extends: def.extends || [],
    })
  }

  return discovered
}
