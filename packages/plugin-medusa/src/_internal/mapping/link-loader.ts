// Link loader — translates Medusa link definitions to Manta ResolvedLinks
// and provides a thin adapter (LinkService) for the Medusa workflow format.
//
// Responsibilities:
//   1. Convert DiscoveredLink (Medusa) → ResolvedLink (Manta core)
//   2. LinkService: translate Medusa's module-keyed format to IRepository calls
//
// NO Drizzle here. The adapter (adapter-database-pg) handles pgTable generation.
// NO custom storage. Links use the same IRepository as module entities.

import type { IRepository } from '@manta/core'
import { type ResolvedLink, registerLink } from '@manta/core'
import { addAlert } from '../alerts'
import type { DiscoveredLink } from '../discovery/links'

// ====================================================================
// Medusa → Manta link conversion
// ====================================================================

export interface ConvertedLink {
  /** The Manta ResolvedLink (registered in core's global registry) */
  resolved: ResolvedLink
  /** Original Medusa export name (e.g. 'CartPaymentCollection') */
  exportName: string
  /** Relationship metadata for the LinkService adapter */
  relationships: { serviceName: string; foreignKey: string; alias: string }[]
}

/**
 * Convert Medusa DiscoveredLinks to Manta ResolvedLinks.
 *
 * Read-write links: creates a defineLink() with table name, FK columns, extra columns.
 * Read-only links: creates a defineLink() with isReadOnlyLink: true.
 */
export function convertMedusaLinks(links: DiscoveredLink[]): ConvertedLink[] {
  const converted: ConvertedLink[] = []

  for (const link of links) {
    if (link.isReadOnly) {
      // Read-only links have `extends` instead of `relationships`
      // Read-only links describe FK traversals via extends[]
      // Each extend has a serviceName + relationship describing the FK
      const exts = link.extends ?? []
      if (exts.length >= 1) {
        // Use first two extends to determine left/right modules
        const left = exts[0]
        const right = exts.length >= 2 ? exts[1] : exts[0]
        const leftRel = left.relationship ?? left
        const rightRel = right.relationship ?? right

        const leftModule = left.serviceName ?? leftRel.serviceName
        const leftEntity = left.entity ?? leftRel.entity ?? leftRel.alias ?? left.serviceName
        const rightModule = rightRel.serviceName ?? right.serviceName
        const rightEntity = right.entity ?? rightRel.entity ?? rightRel.alias ?? rightRel.serviceName
        const leftKey = leftEntity.toLowerCase()
        const rightKey = rightEntity.toLowerCase()
        const resolved = registerLink({
          __type: 'link' as const,
          leftEntity,
          rightEntity,
          leftModule,
          rightModule,
          tableName: `${leftModule}_${leftKey}_${rightModule}_${rightKey}`,
          leftFk: `${leftKey}_id`,
          rightFk: `${rightKey}_id`,
          cardinality: 'M:N',
          cascadeLeft: false,
          cascadeRight: false,
          isReadOnlyLink: true,
        })
        converted.push({
          resolved,
          exportName: link.exportName,
          relationships: [],
        })
      }
      continue
    }

    // Read-write: real pivot table
    if (link.relationships.length < 2) continue

    const [left, right] = link.relationships
    const extraColumns = link.databaseConfig?.extraFields ?? link.databaseConfig?.extraColumns

    const leftEntity = left.entity ?? left.alias ?? left.serviceName
    const rightEntity = right.entity ?? right.alias ?? right.serviceName
    const leftKey = leftEntity.toLowerCase()
    const rightKey = rightEntity.toLowerCase()
    const tableName =
      link.databaseConfig?.tableName ?? `${left.serviceName}_${leftKey}_${right.serviceName}_${rightKey}`
    const resolved = registerLink({
      __type: 'link' as const,
      leftEntity,
      rightEntity,
      leftModule: left.serviceName,
      rightModule: right.serviceName,
      tableName,
      leftFk: `${leftKey}_id`,
      rightFk: `${rightKey}_id`,
      cardinality: 'M:N',
      cascadeLeft: false,
      cascadeRight: false,
      extraColumns: extraColumns ? { ...extraColumns } : undefined,
    })

    converted.push({
      resolved,
      exportName: link.exportName,
      relationships: link.relationships.map((r: Record<string, unknown>) => ({
        serviceName: r.serviceName as string,
        foreignKey: r.foreignKey as string,
        alias: r.alias as string,
      })),
    })
  }

  return converted
}

// ====================================================================
// LinkService — thin adapter over standard IRepository instances
// ====================================================================

/**
 * Link service resolved via container.resolve('link') by Medusa workflows.
 *
 * Translates Medusa's module-keyed format:
 *   { product: { product_id: '...' }, cart: { cart_id: '...' } }
 * to flat FK data:
 *   { product_id: '...', cart_id: '...' }
 * and delegates to the correct IRepository.
 *
 * This is ONLY in the plugin-medusa — it's Medusa format translation,
 * not a core concept.
 */
export class LinkService {
  private repos: Map<string, IRepository>
  private links: ConvertedLink[]

  constructor(links: ConvertedLink[], repos: Map<string, IRepository>) {
    this.links = links.filter((l) => !l.resolved.isReadOnlyLink)
    this.repos = repos
  }

  // biome-ignore lint/suspicious/noExplicitAny: Medusa link data format
  async create(data: any[]): Promise<void> {
    for (const entry of data) {
      const { link, fkData, extra } = this.resolveEntry(entry)
      if (!link) continue

      const repo = this.repos.get(link.resolved.tableName)!
      const existing = await repo.find({ where: fkData })
      if (existing.length > 0) {
        const row = existing[0] as Record<string, unknown>
        await repo.update({ id: row.id, ...extra, deleted_at: null })
      } else {
        const id = `${link.resolved.tableName.slice(0, 8)}_${crypto.randomUUID()}`
        await repo.create({ id, ...fkData, ...extra })
      }
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Medusa link data format
  async dismiss(data: any[]): Promise<void> {
    for (const entry of data) {
      const { link, fkData } = this.resolveEntry(entry)
      if (!link) continue

      const repo = this.repos.get(link.resolved.tableName)!
      const rows = await repo.find({ where: fkData })
      if (rows.length > 0) {
        await repo.softDelete((rows as Record<string, unknown>[]).map((r) => r.id as string))
      }
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Medusa link data format
  async delete(data: any): Promise<void> {
    if (Array.isArray(data)) {
      for (const entry of data) {
        const { link, fkData } = this.resolveEntry(entry)
        if (!link) continue
        const repo = this.repos.get(link.resolved.tableName)!
        const rows = await repo.find({ where: fkData, withDeleted: true })
        if (rows.length > 0) {
          await repo.delete((rows as Record<string, unknown>[]).map((r) => r.id as string))
        }
      }
    } else {
      // Grouped cascade: { moduleName: { fkName: value[] } }
      for (const [_mod, fks] of Object.entries(data)) {
        for (const [fkName, values] of Object.entries(fks as Record<string, unknown>)) {
          const list = Array.isArray(values) ? values : [values]
          for (const value of list) {
            for (const link of this.links) {
              const repo = this.repos.get(link.resolved.tableName)!
              const rows = await repo.find({ where: { [fkName]: value }, withDeleted: true })
              if (rows.length > 0) {
                await repo.delete((rows as Record<string, unknown>[]).map((r) => r.id as string))
              }
            }
          }
        }
      }
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Medusa link data format
  async restore(data: any): Promise<void> {
    if (Array.isArray(data)) {
      for (const entry of data) {
        const { link, fkData } = this.resolveEntry(entry)
        if (!link) continue
        const repo = this.repos.get(link.resolved.tableName)!
        const rows = await repo.find({ where: fkData, withDeleted: true })
        const deleted = (rows as Record<string, unknown>[]).filter((r) => r.deleted_at != null)
        if (deleted.length > 0) {
          await repo.restore(deleted.map((r) => r.id as string))
        }
      }
    } else {
      for (const [_mod, fks] of Object.entries(data)) {
        for (const [fkName, values] of Object.entries(fks as Record<string, unknown>)) {
          const list = Array.isArray(values) ? values : [values]
          for (const value of list) {
            for (const link of this.links) {
              const repo = this.repos.get(link.resolved.tableName)!
              const rows = await repo.find({ where: { [fkName]: value }, withDeleted: true })
              const deleted = (rows as Record<string, unknown>[]).filter((r) => r.deleted_at != null)
              if (deleted.length > 0) {
                await repo.restore(deleted.map((r) => r.id as string))
              }
            }
          }
        }
      }
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Medusa link data format
  async list(data: any[], opts?: { asLinkDefinition?: boolean }): Promise<any[]> {
    const results: unknown[] = []
    for (const entry of data) {
      const { link, fkData } = this.resolveEntry(entry)
      if (!link) continue

      const repo = this.repos.get(link.resolved.tableName)!
      const where: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fkData)) {
        if (v !== undefined && v !== null) where[k] = v
      }
      const rows = await repo.find({ where: Object.keys(where).length > 0 ? where : undefined })

      if (opts?.asLinkDefinition) {
        for (const row of rows as Record<string, unknown>[]) {
          results.push(this.toLinkDefinitionFormat(row, link))
        }
      } else {
        results.push(...rows)
      }
    }
    return results
  }

  getTableNames(): string[] {
    return this.links.map((l) => l.resolved.tableName)
  }

  // ── Private ──────────────────

  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  private resolveEntry(entry: Record<string, any>): {
    link: ConvertedLink | null
    fkData: Record<string, unknown>
    extra: Record<string, unknown>
  } {
    const moduleNames: string[] = []
    const fkData: Record<string, unknown> = {}
    let extra: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(entry)) {
      if (key === 'data') {
        extra = value as Record<string, unknown>
        continue
      }
      if (typeof value === 'object' && value !== null) {
        moduleNames.push(key)
        Object.assign(fkData, value)
      }
    }

    const link =
      this.links.find((l) => {
        const relMods = l.relationships.map((r) => r.serviceName)
        return moduleNames.every((m) => relMods.includes(m))
      }) ?? null

    return { link, fkData, extra }
  }

  private toLinkDefinitionFormat(entry: Record<string, unknown>, link: ConvertedLink): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(entry)) {
      if (['id', 'created_at', 'updated_at', 'deleted_at'].includes(key)) continue
      if (key.endsWith('_id')) {
        const rel = link.relationships.find((r) => r.foreignKey === key)
        if (rel) {
          // biome-ignore lint/suspicious/noExplicitAny: module-keyed result
          ;(result as any)[rel.serviceName] ??= {}
          // biome-ignore lint/suspicious/noExplicitAny: module-keyed result
          ;(result as any)[rel.serviceName][key] = value
          continue
        }
      }
      if (!result.data) result.data = {}
      ;(result.data as Record<string, unknown>)[key] = value
    }
    return result
  }
}

// ====================================================================
// Registration
// ====================================================================

export interface LinkRegistrationResult {
  readWriteLinks: number
  readOnlyLinks: number
  total: number
  convertedLinks: ConvertedLink[]
}

/**
 * Register Medusa link definitions into Manta.
 *
 * 1. Converts Medusa links → Manta ResolvedLinks (via core defineLink())
 * 2. Creates a LinkService backed by the provided repositories
 *
 * @param links - Discovered Medusa link definitions
 * @param createRepo - Factory that creates an IRepository for each link table.
 */
export function registerLinksInApp(
  links: DiscoveredLink[],
  createRepo: (tableName: string) => IRepository,
): { linkService: LinkService; result: LinkRegistrationResult } {
  const convertedLinks = convertMedusaLinks(links)
  const rwLinks = convertedLinks.filter((l) => !l.resolved.isReadOnlyLink)
  const roLinks = convertedLinks.filter((l) => l.resolved.isReadOnlyLink)

  // One IRepository per link table — same as any module entity
  const repos = new Map<string, IRepository>()
  for (const link of rwLinks) {
    repos.set(link.resolved.tableName, createRepo(link.resolved.tableName))
  }

  const linkService = new LinkService(convertedLinks, repos)

  for (const link of rwLinks) {
    const fks = link.relationships.map((r) => r.foreignKey).join(', ')
    const extra = link.resolved.extraColumns
    const extraInfo = extra ? ` + ${Object.keys(extra).join(', ')}` : ''
    addAlert({
      level: 'info',
      layer: 'link',
      artifact: link.exportName,
      message: `Table '${link.resolved.tableName}' (${fks}${extraInfo})`,
    })
  }

  for (const link of roLinks) {
    addAlert({
      level: 'info',
      layer: 'link',
      artifact: link.exportName,
      message: 'Read-only FK link',
    })
  }

  return {
    linkService,
    result: {
      readWriteLinks: rwLinks.length,
      readOnlyLinks: roLinks.length,
      total: links.length,
      convertedLinks,
    },
  }
}
