// SPEC-012 — defineLink() for cross-module relations

/**
 * Link definition — describes a cross-module relation via a pivot table.
 */
export interface LinkDefinition {
  leftModule: string
  leftEntity: string
  rightModule: string
  rightEntity: string
  database?: {
    table?: string
    idPrefix?: string
    extraColumns?: Record<string, unknown>
  }
  isReadOnlyLink?: boolean
  deleteCascade?: {
    left?: boolean
    right?: boolean
  }
}

/**
 * Resolved link with computed table name and metadata.
 */
export interface ResolvedLink extends LinkDefinition {
  tableName: string
  leftFk: string
  rightFk: string
}

// Registry of all defined links
const LINK_REGISTRY: ResolvedLink[] = []

/**
 * defineLink() — declares a cross-module relation.
 *
 * Generates a pivot table with:
 *   - id (TEXT PK)
 *   - {left_entity}_id FK
 *   - {right_entity}_id FK
 *   - created_at, updated_at, deleted_at
 *
 * Read-only links (isReadOnlyLink: true) use an existing FK instead of a pivot table.
 *
 * Usage:
 *   // src/links/product-collection.ts
 *   export default defineLink({
 *     leftModule: 'product',
 *     leftEntity: 'Product',
 *     rightModule: 'collection',
 *     rightEntity: 'Collection',
 *   })
 */
export function defineLink(definition: LinkDefinition): ResolvedLink {
  const leftKey = definition.leftEntity.toLowerCase()
  const rightKey = definition.rightEntity.toLowerCase()

  const tableName = definition.database?.table
    ?? `${definition.leftModule}_${leftKey}_${definition.rightModule}_${rightKey}`

  const resolved: ResolvedLink = {
    ...definition,
    tableName,
    leftFk: `${leftKey}_id`,
    rightFk: `${rightKey}_id`,
  }

  // Auto-register in global registry
  LINK_REGISTRY.push(resolved)

  return resolved
}

/**
 * Get all registered links.
 */
export function getRegisteredLinks(): readonly ResolvedLink[] {
  return LINK_REGISTRY
}

/**
 * Clear the link registry (for testing).
 */
export function clearLinkRegistry(): void {
  LINK_REGISTRY.length = 0
}

/**
 * REMOTE_LINK constant — used as a reference marker in link definitions
 * to indicate a remote/external module link.
 */
export const REMOTE_LINK = Symbol.for('manta:remote_link')
