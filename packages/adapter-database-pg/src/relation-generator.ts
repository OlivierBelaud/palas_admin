// SPEC-011b — Generate Drizzle relations() from DML entities + links
//
// Drizzle's relational query API (`db.query.*.findMany()`) requires `relations()` definitions
// separate from table schemas. This generator produces those relations from:
// 1. Intra-module DML relations (hasMany, hasOne, belongsTo, manyToMany)
// 2. Cross-module links (defineLink pivot tables)

import type { ParsedDmlRelation, ResolvedLink } from '@manta/core'
import type { AnyColumn, Table as DrizzleTable } from 'drizzle-orm'
import { relations } from 'drizzle-orm'

/**
 * Drizzle relation definition — describes one side of a relation.
 */
export interface DrizzleRelationDef {
  /** The entity (table) that owns this relation declaration */
  sourceEntity: string
  /** The relation name (used in `with: { variants: true }`) */
  name: string
  /** 'one' or 'many' */
  kind: 'one' | 'many'
  /** Target entity name */
  target: string
  /** For 'one' relations: the FK column on the source table */
  fields?: string[]
  /** For 'one' relations: the referenced column on the target table */
  references?: string[]
}

/**
 * Input for generating relations — a module's parsed DML entity metadata.
 */
export interface EntityRelationInput {
  entityName: string
  tableName: string
  relations: ParsedDmlRelation[]
}

/**
 * Generate Drizzle relation definitions from DML entities (intra-module).
 *
 * Maps DML relation types to Drizzle relation kinds:
 * - hasMany(Target) → many(targets)
 * - hasOne(Target) → one(targets, { fields: [source.target_id], references: [targets.id] })
 * - hasOneWithFK(Target) → one(targets, { fields: [source.target_id], references: [targets.id] })
 * - belongsTo(Target) → one(targets, { fields: [source.target_id], references: [targets.id] })
 * - manyToMany(Target) → many(pivotTable) on both sides + pivot table has two one() relations
 */
export function generateIntraModuleRelations(entities: EntityRelationInput[]): DrizzleRelationDef[] {
  const defs: DrizzleRelationDef[] = []
  const entityNameToTable = new Map<string, string>()

  for (const entity of entities) {
    entityNameToTable.set(entity.entityName.toLowerCase(), entity.tableName)
  }

  for (const entity of entities) {
    for (const rel of entity.relations) {
      const targetTable = entityNameToTable.get(rel.target.toLowerCase()) ?? rel.target.toLowerCase()

      switch (rel.type) {
        case 'hasMany': {
          defs.push({
            sourceEntity: entity.tableName,
            name: rel.name,
            kind: 'many',
            target: targetTable,
          })
          break
        }

        case 'hasOne':
        case 'hasOneWithFK': {
          // FK is on the source table
          const fkColumn = `${rel.name}_id`
          defs.push({
            sourceEntity: entity.tableName,
            name: rel.name,
            kind: 'one',
            target: targetTable,
            fields: [fkColumn],
            references: ['id'],
          })
          break
        }

        case 'belongsTo': {
          // FK is on the source table
          const fkColumn = `${rel.target.toLowerCase()}_id`
          defs.push({
            sourceEntity: entity.tableName,
            name: rel.name,
            kind: 'one',
            target: targetTable,
            fields: [fkColumn],
            references: ['id'],
          })
          break
        }

        case 'manyToMany': {
          // M:N via pivot table — source has many(pivot), target has many(pivot)
          // The pivot table name follows the convention: source_target
          const pivotTable = rel.pivotEntity?.toLowerCase() ?? `${entity.tableName}_${targetTable}`

          defs.push({
            sourceEntity: entity.tableName,
            name: rel.name,
            kind: 'many',
            target: pivotTable,
          })

          // Pivot → source (one)
          defs.push({
            sourceEntity: pivotTable,
            name: entity.tableName,
            kind: 'one',
            target: entity.tableName,
            fields: [`${entity.tableName}_id`],
            references: ['id'],
          })

          // Pivot → target (one)
          defs.push({
            sourceEntity: pivotTable,
            name: targetTable,
            kind: 'one',
            target: targetTable,
            fields: [`${targetTable}_id`],
            references: ['id'],
          })
          break
        }
      }
    }
  }

  return defs
}

/**
 * Generate Drizzle relation definitions from cross-module links.
 *
 * Each link creates a pivot table with FK relations to both sides:
 * - leftEntity → many(pivotTable)
 * - rightEntity → many(pivotTable)
 * - pivotTable → one(leftEntity), one(rightEntity)
 */
export function generateLinkRelations(links: readonly ResolvedLink[]): DrizzleRelationDef[] {
  const defs: DrizzleRelationDef[] = []

  /** snake_case/any → camelCase */
  const toCamel = (s: string) => s.replace(/[_-]([a-z])/g, (_: string, c: string) => c.toUpperCase())

  /** Pluralize: 'customer' → 'customers', 'customerGroup' → 'customerGroups' */
  const _pluralize = (s: string) => {
    if (s.endsWith('s') || s.endsWith('x') || s.endsWith('ch') || s.endsWith('sh')) return `${s}es`
    if (s.endsWith('y') && !/[aeiou]y$/i.test(s)) return `${s.slice(0, -1)}ies`
    return `${s}s`
  }

  for (const link of links) {
    const leftEntity = link.leftEntity.toLowerCase()
    const rightEntity = link.rightEntity.toLowerCase()
    const pivotTable = link.tableName
    const _isMany = link.cardinality === 'M:N'

    const leftCamel = toCamel(leftEntity)
    const rightCamel = toCamel(rightEntity)

    // Relation name = camelCase of pivot table name
    // e.g. 'customer_customer_group' → 'customerCustomerGroup'
    // TODO: rename to entity-based names (customers/customerGroups) once Drizzle schema key matching is stable
    const pivotCamel = toCamel(pivotTable)

    // Left entity → many(pivot)
    defs.push({
      sourceEntity: leftEntity,
      name: pivotCamel,
      kind: 'many',
      target: pivotTable,
    })

    // Right entity → many(pivot)
    defs.push({
      sourceEntity: rightEntity,
      name: pivotCamel,
      kind: 'many',
      target: pivotTable,
    })

    // Pivot → one(left)
    defs.push({
      sourceEntity: pivotTable,
      name: leftCamel,
      kind: 'one',
      target: leftEntity,
      fields: [link.leftFk],
      references: ['id'],
    })

    // Pivot → one(right)
    defs.push({
      sourceEntity: pivotTable,
      name: rightCamel,
      kind: 'one',
      target: rightEntity,
      fields: [link.rightFk],
      references: ['id'],
    })
  }

  return defs
}

/**
 * Build real Drizzle `Relations` objects from DrizzleRelationDef[] + actual Drizzle tables.
 *
 * This is the critical bridge: it converts our intermediate `DrizzleRelationDef` descriptors
 * into actual `relations()` calls that Drizzle's relational query API understands.
 *
 * @param defs - Relation definitions (from generateIntraModuleRelations + generateLinkRelations)
 * @param tables - Map of table name → actual Drizzle PgTable instance
 * @returns Schema entries to spread into the Drizzle schema object
 *
 * @example
 * const schema = {
 *   ...allTables,
 *   ...buildDrizzleRelations(defs, tableMap),
 * }
 * const db = drizzle(sql, { schema })
 * // Now db.query.products.findMany({ with: { variants: true } }) works!
 */
export function buildDrizzleRelations(
  defs: DrizzleRelationDef[],
  tables: Record<string, DrizzleTable>,
): Record<string, unknown> {
  // Group defs by source entity
  const grouped = new Map<string, DrizzleRelationDef[]>()
  for (const def of defs) {
    const existing = grouped.get(def.sourceEntity) ?? []
    if (!existing.some((d) => d.name === def.name)) {
      existing.push(def)
    }
    grouped.set(def.sourceEntity, existing)
  }

  // Build a normalized lookup: strip underscores/hyphens and lowercase → actual table key
  const normalizedTableLookup = new Map<string, string>()
  for (const key of Object.keys(tables)) {
    normalizedTableLookup.set(key.replace(/[_\s-]/g, '').toLowerCase(), key)
  }
  const findTable = (name: string): DrizzleTable | undefined => {
    // Try exact match first
    if (tables[name]) return tables[name]
    // Try normalized lookup (strip separators + lowercase)
    const normalized = name.replace(/[_\s-]/g, '').toLowerCase()
    const actualKey = normalizedTableLookup.get(normalized)
    if (actualKey) return tables[actualKey]
    // Try pluralized (entity name → table name convention)
    // Must match entityToTableKey() pluralization: -s/-x/-ch/-sh → +es, consonant+y → +ies, else → +s
    let pluralized: string
    if (
      normalized.endsWith('s') ||
      normalized.endsWith('x') ||
      normalized.endsWith('ch') ||
      normalized.endsWith('sh')
    ) {
      pluralized = `${normalized}es`
    } else if (normalized.endsWith('y') && !/[aeiou]y$/i.test(normalized)) {
      pluralized = `${normalized.slice(0, -1)}ies`
    } else {
      pluralized = `${normalized}s`
    }
    const pluralKey = normalizedTableLookup.get(pluralized)
    return pluralKey ? tables[pluralKey] : undefined
  }

  const result: Record<string, unknown> = {}

  for (const [sourceEntity, entityDefs] of grouped) {
    const sourceTable = findTable(sourceEntity)
    if (!sourceTable) continue

    // Create a real Drizzle relations() definition for this source table
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle relations() callback type is complex
    const relDef = relations(sourceTable, ((helpers: any) => {
      const config: Record<string, unknown> = {}

      for (const def of entityDefs) {
        const targetTable = findTable(def.target)
        if (!targetTable) continue

        if (def.kind === 'many') {
          config[def.name] = helpers.many(targetTable)
        } else {
          // 'one' — need to resolve FK columns
          if (def.fields && def.references) {
            const fkColumns = def.fields
              .map((f) => (sourceTable as unknown as Record<string, unknown>)[f])
              .filter(Boolean) as AnyColumn[]
            const refColumns = def.references
              .map((r) => (targetTable as unknown as Record<string, unknown>)[r])
              .filter(Boolean) as AnyColumn[]

            if (fkColumns.length > 0 && refColumns.length > 0) {
              config[def.name] = helpers.one(targetTable, {
                fields: fkColumns as [AnyColumn, ...AnyColumn[]],
                references: refColumns as [AnyColumn, ...AnyColumn[]],
              })
            } else {
              // FK columns not found on table — fall back to simple one() without config
              // This can happen for hasMany inverse side where FK is on the other table
              config[def.name] = helpers.one(targetTable)
            }
          } else {
            config[def.name] = helpers.one(targetTable)
          }
        }
      }

      return config
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle relations() callback uses a builder pattern with dynamically typed helpers
    }) as any)

    // Drizzle expects {tableKey}Relations to match {tableKey} in the schema.
    // Find the actual table key that matched via findTable.
    const normalizedSource = sourceEntity.replace(/[_\s-]/g, '').toLowerCase()
    const pluralizedSource = normalizedSource.endsWith('s') ? normalizedSource : `${normalizedSource}s`
    const actualTableKey =
      normalizedTableLookup.get(normalizedSource) ?? normalizedTableLookup.get(pluralizedSource) ?? sourceEntity
    result[`${actualTableKey}Relations`] = relDef
  }

  return result
}

/**
 * Merge intra-module + link relations into a single set, grouped by source entity.
 */
export function mergeRelationDefs(...defSets: DrizzleRelationDef[][]): Map<string, DrizzleRelationDef[]> {
  const merged = new Map<string, DrizzleRelationDef[]>()

  for (const defs of defSets) {
    for (const def of defs) {
      const existing = merged.get(def.sourceEntity) ?? []
      // Deduplicate by name
      if (!existing.some((d) => d.name === def.name)) {
        existing.push(def)
      }
      merged.set(def.sourceEntity, existing)
    }
  }

  return merged
}
