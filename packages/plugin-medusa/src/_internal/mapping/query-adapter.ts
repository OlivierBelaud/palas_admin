// MedusaQueryAdapter — bridges Manta's module services to Medusa's query formats.
//
// Two patterns used by Medusa routes:
//   1. query.graph({ entity, fields, filters, pagination }) → { data: T[], metadata: { count, skip, take } }
//   2. remoteQuery(remoteQueryObjectFromString({...})) → { rows, metadata: { count, skip, take } }
//
// Both ultimately call module services' listAndCount() under the hood.

// biome-ignore lint/suspicious/noExplicitAny: Medusa module services are untyped
type ModuleService = Record<string, any>

export interface MedusaQueryGraphConfig {
  entity: string
  fields?: string[]
  filters?: Record<string, unknown>
  pagination?: { limit?: number; offset?: number; order?: Record<string, string> }
  withDeleted?: boolean
}

export interface MedusaQueryGraphResult<T = unknown> {
  data: T[]
  metadata: { count: number; skip: number; take: number }
}

/**
 * Wraps Manta module services to produce the Medusa query.graph() format.
 *
 * Medusa routes do: `const { data, metadata } = await query.graph({ entity: 'product', fields, filters })`
 * This adapter resolves the entity to a module service, calls listAndCount(), and returns
 * the Medusa-expected `{ data, metadata: { count, skip, take } }` format.
 */
export class MedusaQueryAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic module map
  private modules: Record<string, any>

  // biome-ignore lint/suspicious/noExplicitAny: dynamic module map
  constructor(modules: Record<string, any>) {
    this.modules = modules
  }

  async graph<T = unknown>(config: MedusaQueryGraphConfig): Promise<MedusaQueryGraphResult<T>> {
    const service = this.resolveService(config.entity)
    const take = config.pagination?.limit ?? 20
    const skip = config.pagination?.offset ?? 0

    if (service && typeof service.listAndCount === 'function') {
      const [data, count] = await service.listAndCount(config.filters ?? {}, {
        take,
        skip,
        select: config.fields,
        order: config.pagination?.order,
        withDeleted: config.withDeleted,
      })
      return { data, metadata: { count, skip, take } }
    }

    // Fallback: try list() if listAndCount not available
    if (service && typeof service.list === 'function') {
      const data = await service.list(config.filters ?? {}, {
        take,
        skip,
        select: config.fields,
        order: config.pagination?.order,
        withDeleted: config.withDeleted,
      })
      return { data, metadata: { count: data.length, skip, take } }
    }

    // No service found — return empty
    return { data: [] as T[], metadata: { count: 0, skip, take } }
  }

  private resolveService(entity: string): ModuleService | null {
    // Try exact match
    if (this.modules[entity]) return this.modules[entity]

    // Try singularized (products → product)
    const singular = singularize(entity)
    if (this.modules[singular]) return this.modules[singular]

    // Try pluralized (product → products)
    const plural = `${entity}s`
    if (this.modules[plural]) return this.modules[plural]

    // Try camelCase variant (sales-channel → salesChannel)
    const camel = entity.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    if (this.modules[camel]) return this.modules[camel]

    return null
  }
}

/**
 * Creates a callable remoteQuery function for Medusa routes.
 *
 * Medusa routes do: `const result = await remoteQuery(remoteQueryObjectFromString({...}))`
 * The remoteQueryObjectFromString() returns an object with a `__value` wrapper.
 *
 * Returns `{ rows, metadata: { count, skip, take } }` format.
 */
// biome-ignore lint/suspicious/noExplicitAny: dynamic module map
export function createRemoteQueryCallable(modules: Record<string, any>): RemoteQueryFunction {
  const adapter = new MedusaQueryAdapter(modules)

  // biome-ignore lint/suspicious/noExplicitAny: Medusa query objects are dynamic
  return async (queryObj: any) => {
    // remoteQueryObjectFromString wraps in __value
    const value = queryObj?.__value ?? queryObj
    if (!value || typeof value !== 'object') {
      return Object.assign([], { metadata: { count: 0, skip: 0, take: 20 } })
    }

    // Value is { entityName: { __args: { filters, ... }, fields: [...] } }
    const entityNames = Object.keys(value)
    if (entityNames.length === 0) {
      return Object.assign([], { metadata: { count: 0, skip: 0, take: 20 } })
    }

    const [entityName] = entityNames
    const config = value[entityName]
    const args = config?.__args ?? {}
    const fields = Array.isArray(config?.fields) ? config.fields : extractFieldNames(config)

    const take = args.limit ?? args.pagination?.limit ?? 20
    const skip = args.offset ?? args.pagination?.offset ?? 0
    const filters = args.filters ?? args.where ?? {}

    const result = await adapter.graph({
      entity: entityName,
      fields,
      filters,
      pagination: { limit: take, offset: skip },
    })

    // Medusa remoteQuery returns rows[] with .metadata attached
    const rows = result.data as unknown[]
    return Object.assign(rows, { metadata: result.metadata })
  }
}

export type RemoteQueryFunction = (
  // biome-ignore lint/suspicious/noExplicitAny: Medusa query object
  queryObj: any,
  // biome-ignore lint/suspicious/noExplicitAny: Medusa result
) => Promise<any[] & { metadata: { count: number; skip: number; take: number } }>

// ── Helpers ──────────────────────────────────

function singularize(word: string): string {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes')) return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

// biome-ignore lint/suspicious/noExplicitAny: extract field names from query object
function extractFieldNames(config: any): string[] | undefined {
  if (!config || typeof config !== 'object') return undefined
  const fields: string[] = []
  for (const key of Object.keys(config)) {
    if (key === '__args' || key === 'fields') continue
    if (typeof config[key] === 'boolean' && config[key]) {
      fields.push(key)
    }
  }
  return fields.length > 0 ? fields : undefined
}
