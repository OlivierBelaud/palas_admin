// SPEC-012 — defineLink() for cross-module relations
// Callback API only: defineLink((m) => [m.Product, many(m.Variant)])

import { MantaError } from '../errors/manta-error'

// ── Model reference types ───────────────────────────────

/**
 * A reference to a DML entity, produced by createModelProxy().
 */
export interface ModelRef {
  __modelRef: true
  entityName: string
}

/**
 * A "many" reference — wraps a ModelRef to indicate the "many" side of a relation.
 */
export interface ManyRef extends ModelRef {
  __many: true
}

/**
 * Typed model proxy — provides autocomplete for all entities in the app.
 * MantaGeneratedEntities is populated by codegen (.manta/types/types.ts).
 * Falls back to Record<string, ModelRef> when codegen hasn't run.
 */
export type ModelProxy = {
  [K in keyof MantaGeneratedEntities]: ModelRef
} & Record<string, ModelRef>

// ── Resolved link ───────────────────────────────────────

/**
 * Resolved link with computed table name, cardinality, and cascade rules.
 */
export interface ResolvedLink {
  __type: 'link'
  leftEntity: string
  rightEntity: string
  leftModule?: string
  rightModule?: string
  tableName: string
  leftFk: string
  rightFk: string
  cardinality: '1:1' | '1:N' | 'M:N'
  cascadeLeft: boolean
  cascadeRight: boolean
  extraColumns?: Record<string, unknown>
  isReadOnlyLink?: boolean
  /**
   * When true, this is an intra-module link with 1:1 or 1:N cardinality.
   * The framework adds a FK column directly on the child entity instead of creating a pivot table.
   * Set by the bootstrap when both entities belong to the same module.
   */
  isDirectFk?: boolean
}

// ── Helpers ─────────────────────────────────────────────

/**
 * Entity name type — autocompletes from MantaGeneratedEntities (codegen).
 */
type EntityNameArg = keyof MantaGeneratedEntities | (string & {})

/**
 * Wrap a ModelRef or entity name to indicate "many" cardinality.
 *
 * @example
 * many('inventory_item')
 * many(model.inventory_item)  // legacy callback form
 */
export function many(refOrName: ModelRef | EntityNameArg): ManyRef {
  if (typeof refOrName === 'string') {
    return { __modelRef: true, entityName: refOrName, __many: true } as ManyRef
  }
  return { ...refOrName, __many: true } as ManyRef
}

/**
 * Create a Proxy where any property access returns a ModelRef.
 *
 * @example
 * const m = createModelProxy()
 * m.Product  // → { __modelRef: true, entityName: 'Product' }
 */
export function createModelProxy(): ModelProxy {
  return new Proxy({} as Record<string, ModelRef>, {
    get(_, prop: string) {
      return { __modelRef: true, entityName: prop } as ModelRef
    },
  })
}

function isModelRef(value: unknown): value is ModelRef {
  return typeof value === 'object' && value !== null && '__modelRef' in value && (value as ModelRef).__modelRef === true
}

function isManyRef(value: unknown): value is ManyRef {
  return isModelRef(value) && '__many' in value && (value as ManyRef).__many === true
}

// ── Registry ────────────────────────────────────────────

const LINK_REGISTRY: ResolvedLink[] = []

// ── defineLink ──────────────────────────────────────────

/**
 * Define a cross-module link.
 *
 * @example
 * // String form (preferred)
 * defineLink('product', many('variant'))
 * defineLink('product', 'collection', { sortOrder: field.number() })
 *
 * // Legacy callback form
 * defineLink((m) => [m.product, many(m.variant)])
 */
export function defineLink(
  leftOrCallback: EntityNameArg | ManyRef | ((model: ModelProxy) => [ModelRef | ManyRef, ModelRef | ManyRef]),
  rightOrExtraColumns?: EntityNameArg | ModelRef | ManyRef | Record<string, unknown>,
  extraColumns?: Record<string, unknown>,
): ResolvedLink {
  let left: ModelRef | ManyRef
  let right: ModelRef | ManyRef
  let extra: Record<string, unknown> | undefined

  if (typeof leftOrCallback === 'function') {
    // Legacy callback form
    const proxy = createModelProxy()
    ;[left, right] = leftOrCallback(proxy)
    extra = rightOrExtraColumns as Record<string, unknown> | undefined
  } else {
    // String form: defineLink('product', 'variant') or defineLink('product', many('variant'))
    // Also handle: defineLink(many('customer'), many('customer_group'))
    if (isModelRef(leftOrCallback as unknown)) {
      left = leftOrCallback as unknown as ModelRef | ManyRef
    } else {
      left = { __modelRef: true, entityName: leftOrCallback } as ModelRef
    }
    if (typeof rightOrExtraColumns === 'string') {
      right = { __modelRef: true, entityName: rightOrExtraColumns } as ModelRef
    } else if (isModelRef(rightOrExtraColumns as unknown)) {
      right = rightOrExtraColumns as ModelRef | ManyRef
    } else {
      throw new MantaError('INVALID_DATA', 'defineLink: second argument must be an entity name string or many()')
    }
    extra = extraColumns
  }

  if (!isModelRef(left) || !isModelRef(right)) {
    throw new MantaError('INVALID_DATA', 'defineLink callback must return an array of two ModelRef values')
  }

  // Validate entity names: must be camelCase (e.g. 'customer', 'customerGroup'), not snake_case
  for (const ref of [left, right]) {
    const name = ref.entityName
    if (name.includes('_')) {
      const camel = name.toLowerCase().replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase())
      throw new MantaError(
        'INVALID_DATA',
        `defineLink: entity name "${name}" must be camelCase. Use "${camel}" instead of "${name}".`,
      )
    }
    if (name.includes('-')) {
      const camel = name.toLowerCase().replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase())
      throw new MantaError(
        'INVALID_DATA',
        `defineLink: entity name "${name}" must be camelCase. Use "${camel}" instead of "${name}".`,
      )
    }
  }

  const leftEntity = left.entityName
  const rightEntity = right.entityName

  if (leftEntity === rightEntity) {
    throw new MantaError(
      'INVALID_DATA',
      `defineLink: both sides reference the same entity "${leftEntity}". Self-links are not supported.`,
    )
  }

  // Check for duplicates
  const duplicate = LINK_REGISTRY.find((l) => l.leftEntity === leftEntity && l.rightEntity === rightEntity)
  if (duplicate) {
    throw new MantaError(
      'DUPLICATE_ERROR',
      `Link between "${leftEntity}" and "${rightEntity}" is already defined (table: "${duplicate.tableName}"). Each entity pair can only have one link.`,
    )
  }

  // Infer cardinality
  const leftMany = isManyRef(left)
  const rightMany = isManyRef(right)
  let cardinality: '1:1' | '1:N' | 'M:N'
  if (leftMany && rightMany) {
    cardinality = 'M:N'
  } else if (leftMany || rightMany) {
    cardinality = '1:N'
  } else {
    cardinality = '1:1'
  }

  // Auto-cascade rules:
  // 1:1 — deleting either side cascades to the other entity
  // 1:N — deleting the "one" side cascades to the "many" side, not the reverse
  // M:N — no entity cascade (pivot rows always cleaned up regardless)
  let cascadeLeft: boolean
  let cascadeRight: boolean
  if (cardinality === '1:1') {
    cascadeLeft = true
    cascadeRight = true
  } else if (cardinality === '1:N') {
    // "one" side cascades to "many" side
    // If right is many → left is one → cascadeLeft=true (deleting left cascades to right)
    // If left is many → right is one → cascadeRight=true (deleting right cascades to left)
    cascadeLeft = rightMany
    cascadeRight = leftMany
  } else {
    cascadeLeft = false
    cascadeRight = false
  }

  // DB names use snake_case: 'customerGroup' → 'customer_group'
  const leftSnake = leftEntity.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
  const rightSnake = rightEntity.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
  const tableName = `${leftSnake}_${rightSnake}`

  const resolved: ResolvedLink = {
    __type: 'link',
    leftEntity,
    rightEntity,
    tableName,
    leftFk: `${leftSnake}_id`,
    rightFk: `${rightSnake}_id`,
    cardinality,
    cascadeLeft,
    cascadeRight,
    extraColumns: extra,
  }

  LINK_REGISTRY.push(resolved)
  return resolved
}

// ── Public registry API ─────────────────────────────────

/**
 * Register a pre-built ResolvedLink directly into the registry.
 * Used by plugins that build links from external discovery (e.g. Medusa compat).
 */
export function registerLink(resolved: ResolvedLink): ResolvedLink {
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
