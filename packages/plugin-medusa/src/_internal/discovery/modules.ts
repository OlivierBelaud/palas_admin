// Module discovery — scans @medusajs/medusa/dist/modules/ for core modules,
// extracts service classes and DML entities.

import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { addAlert } from '../alerts'

const require = createRequire(import.meta.url)

// Providers and infra adapters — we skip these (user chooses their own adapters in Manta)
const PROVIDER_PATTERNS = [
  '-local',
  '-redis',
  '-s3',
  '-postgres',
  '-sendgrid',
  '-stripe',
  '-inmemory',
  '-posthog',
  '-emailpass',
  '-github',
  '-google',
  '-manual',
]

function isProvider(name: string): boolean {
  return PROVIDER_PATTERNS.some((p) => name.endsWith(p))
}

// Infra modules that require specific adapters (not portable without their provider)
const INFRA_MODULES = ['caching', 'index-module']

function isInfraModule(name: string): boolean {
  return INFRA_MODULES.includes(name)
}

/**
 * Parsed intra-module relation from a DML entity.
 * Compatible with @manta/core's ParsedDmlRelation.
 */
export interface DiscoveredRelation {
  /** Property name on the entity (e.g. 'variants') */
  name: string
  /** Relation type: hasMany, belongsTo, hasOne, hasOneWithFK, manyToMany */
  type: string
  /** Target entity name (e.g. 'ProductVariant') */
  target: string
  /** The mappedBy inverse property name (e.g. 'product') */
  mappedBy?: string
  /** Whether the FK is on this entity */
  foreignKey?: boolean
  /** Whether the relation is nullable */
  nullable?: boolean
  /** For manyToMany: explicit pivot entity name (e.g. 'ProductVariantProductImage') */
  pivotEntity?: string
  /** For manyToMany: explicit pivot table name (e.g. 'product_tags') */
  pivotTable?: string
}

export interface DiscoveredModel {
  name: string
  // biome-ignore lint/suspicious/noExplicitAny: DML entity from Medusa
  schema: Record<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: raw DML entity object
  raw: any
  /** Intra-module relations parsed from the DML schema */
  relations: DiscoveredRelation[]
}

export interface DiscoveredModule {
  /** Module name (e.g. 'product', 'order') */
  name: string
  /** Service class name (e.g. 'ProductModuleService') */
  serviceName: string
  /** Service class constructor */
  // biome-ignore lint/suspicious/noExplicitAny: Medusa service class
  service: any
  /** Path to the module's package (discoveryPath) */
  discoveryPath: string | null
  /** DML entities discovered from the module's models/ directory */
  models: DiscoveredModel[]
  /** The linkable config if available */
  // biome-ignore lint/suspicious/noExplicitAny: Medusa linkable config
  linkable: any
}

/**
 * Resolve the @medusajs/medusa dist/modules/ directory.
 */
function resolveMedusaModulesDir(): string {
  const medusaPkg = require.resolve('@medusajs/medusa/package.json')
  return join(dirname(medusaPkg), 'dist', 'modules')
}

/** Medusa relation class names that indicate a DML relation property */
const RELATION_CONSTRUCTORS = new Set([
  'HasMany',
  'BelongsTo',
  'HasOne',
  'HasOneWithFK',
  'ManyToMany',
  'RelationNullableModifier',
])

/**
 * Extract intra-module relations from a DML entity schema.
 *
 * Medusa DML relation properties have a `.parse(name)` method that returns:
 *   { name, type, entity: () => TargetEntity, mappedBy, nullable, options }
 *
 * We convert these to DiscoveredRelation (compatible with ParsedDmlRelation).
 */
function extractRelations(schema: Record<string, unknown>): DiscoveredRelation[] {
  const relations: DiscoveredRelation[] = []

  for (const [propName, prop] of Object.entries(schema)) {
    // biome-ignore lint/suspicious/noExplicitAny: Medusa DML property
    const p = prop as any
    const ctorName = p?.constructor?.name || ''

    // Check if this property is a DML relation
    if (!RELATION_CONSTRUCTORS.has(ctorName) && typeof p?.parse !== 'function') continue
    if (!p?.type || !['hasMany', 'belongsTo', 'hasOne', 'hasOneWithFK', 'manyToMany'].includes(p.type)) continue

    try {
      const parsed = p.parse(propName)

      // Resolve target entity name via the lazy entity() reference
      let targetName = 'unknown'
      try {
        const entity = parsed.entity()
        targetName = entity?.name || 'unknown'
      } catch {
        // entity() may fail if target is not loaded — skip silently
      }
      if (targetName === 'unknown') continue

      const rel: DiscoveredRelation = {
        name: parsed.name,
        type: parsed.type,
        target: targetName,
        mappedBy: parsed.mappedBy || parsed.options?.mappedBy,
        nullable: parsed.nullable ?? false,
      }

      // hasOne with foreignKey option
      if (parsed.options?.foreignKey) {
        rel.foreignKey = true
      }

      // manyToMany: resolve pivotEntity or pivotTable
      if (parsed.type === 'manyToMany' && parsed.options) {
        if (typeof parsed.options.pivotEntity === 'function') {
          try {
            const pe = parsed.options.pivotEntity()
            rel.pivotEntity = pe?.name || undefined
          } catch {
            // Pivot entity not resolvable
          }
        }
        if (parsed.options.pivotTable) {
          rel.pivotTable = parsed.options.pivotTable
        }
      }

      relations.push(rel)
    } catch {
      // parse() failed — property is not a valid relation
    }
  }

  return relations
}

/**
 * Load DML models from a module's discoveryPath.
 * Extracts both schema properties and intra-module relations.
 */
function loadModels(discoveryPath: string): DiscoveredModel[] {
  const modelsDir = join(dirname(discoveryPath), 'models')
  const modelsIndex = join(modelsDir, 'index.js')

  if (!existsSync(modelsIndex)) return []

  try {
    const models = require(modelsIndex)
    const result: DiscoveredModel[] = []

    for (const [name, model] of Object.entries(models)) {
      // biome-ignore lint/suspicious/noExplicitAny: DML entity
      const m = model as any
      const schema = m?.schema || m?.__schema || {}
      const relations = extractRelations(schema)
      result.push({ name, schema, raw: m, relations })
    }

    return result
  } catch (err) {
    addAlert({
      level: 'warn',
      layer: 'module',
      artifact: discoveryPath,
      message: `Could not load models: ${(err as Error).message}`,
    })
    return []
  }
}

/**
 * Discover all core Medusa modules.
 * Returns an array of DiscoveredModule with service info and DML entities.
 */
export function discoverModules(): DiscoveredModule[] {
  const modulesDir = resolveMedusaModulesDir()
  const files = readdirSync(modulesDir).filter((f) => f.endsWith('.js') && !f.endsWith('.js.map'))
  const discovered: DiscoveredModule[] = []

  for (const file of files) {
    const name = file.replace('.js', '')

    // Skip providers and infra adapters
    if (isProvider(name)) continue
    // Skip link-modules (handled in Layer 4)
    if (name === 'link-modules') continue
    // Skip infra modules that need specific adapters
    if (isInfraModule(name)) continue

    try {
      const mod = require(join(modulesDir, file))
      const def = mod.default || mod
      const discoveryPath = mod.discoveryPath || null
      const service = def.service
      const serviceName = service?.name || 'unknown'
      const linkable = def.linkable || null

      // Load DML models if discoveryPath available
      const models = discoveryPath ? loadModels(discoveryPath) : []

      discovered.push({
        name,
        serviceName,
        service,
        discoveryPath,
        models,
        linkable,
      })

      // Alert if module has no service
      if (!service) {
        addAlert({
          level: 'warn',
          layer: 'module',
          artifact: name,
          message: 'Module has no service class',
        })
      }

      // Alert if module has custom methods beyond CRUD
      if (service?.prototype) {
        const ownMethods = Object.getOwnPropertyNames(service.prototype).filter(
          (m) => m !== 'constructor' && !m.startsWith('_'),
        )
        const crudPrefixes = [
          'retrieve',
          'list',
          'listAndCount',
          'create',
          'update',
          'delete',
          'softDelete',
          'restore',
          'upsert',
          'upsertWithReplace',
        ]
        const customMethods = ownMethods.filter((m) => !crudPrefixes.some((p) => m.startsWith(p)))
        if (customMethods.length > 0) {
          addAlert({
            level: 'info',
            layer: 'module',
            artifact: name,
            message: `${customMethods.length} custom methods beyond CRUD: ${customMethods.slice(0, 5).join(', ')}${customMethods.length > 5 ? '...' : ''}`,
          })
        }
      }
    } catch (err) {
      addAlert({
        level: 'error',
        layer: 'module',
        artifact: name,
        message: `Failed to load module: ${(err as Error).message}`,
      })
    }
  }

  return discovered
}

/**
 * Build entity relation inputs from discovered modules.
 *
 * Produces the format expected by @manta/adapter-database-pg's
 * `generateIntraModuleRelations()` — ready for Drizzle relation generation.
 *
 * Table name convention: lowercase entity name + 's' (e.g. Product → products).
 */
export function buildEntityRelationInputs(modules: DiscoveredModule[]): {
  entityName: string
  tableName: string
  relations: { name: string; type: string; target: string; foreignKey?: boolean; pivotEntity?: string }[]
}[] {
  const inputs: {
    entityName: string
    tableName: string
    relations: { name: string; type: string; target: string; foreignKey?: boolean; pivotEntity?: string }[]
  }[] = []

  for (const mod of modules) {
    for (const model of mod.models) {
      if (model.relations.length === 0) continue

      inputs.push({
        entityName: model.name,
        tableName: toTableName(model.name),
        relations: model.relations.map((r) => ({
          name: r.name,
          type: r.type,
          target: r.target,
          foreignKey: r.foreignKey,
          pivotEntity: r.pivotEntity ?? r.pivotTable,
        })),
      })
    }
  }

  return inputs
}

/**
 * Convert an entity name to a table name.
 * ProductVariant → product_variants, Product → products
 */
function toTableName(entityName: string): string {
  // Convert PascalCase to snake_case, then pluralize
  const snake = entityName
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
  return snake.endsWith('s') ? snake : `${snake}s`
}

/**
 * Build entity-to-service mapping from discovered modules.
 * Maps entity names to module service keys for Query engine resolution.
 */
export function buildEntityMap(modules: DiscoveredModule[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const mod of modules) {
    for (const model of mod.models) {
      // Map entity name to module name (which is the service key)
      map[model.name.toLowerCase()] = mod.name
      // Also map plural forms
      const plural = `${model.name.toLowerCase()}s`
      map[plural] = mod.name
    }
  }
  return map
}
