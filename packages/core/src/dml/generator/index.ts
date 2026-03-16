// SPEC-057f — DML→Drizzle schema generator

import { MantaError } from '../../errors/manta-error'

export interface GeneratedSchema {
  columns: Record<string, { type: string; notNull?: boolean; default?: unknown }>
  relations: Record<string, { type: string; target: string }>
  indexes: Array<{ name: string; columns: string[]; unique?: boolean; where?: string; using?: string }>
  checks: Array<{ name: string; expression: string }>
}

/** DML property type → Drizzle/PG column type mapping */
const DML_TYPE_MAP: Record<string, string> = {
  id: 'TEXT',
  text: 'TEXT',
  number: 'INTEGER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  bigNumber: 'NUMERIC',
  float: 'REAL',
  serial: 'SERIAL',
  dateTime: 'TIMESTAMPTZ',
  json: 'JSONB',
  enum: 'TEXT',
  array: 'JSONB',
}

const IMPLICIT_COLUMNS = ['id', 'created_at', 'updated_at', 'deleted_at']

interface ParsedDmlProperty {
  name: string
  type: string
  nullable?: boolean
  computed?: boolean
  default?: unknown
  values?: unknown
}

interface ParsedDmlRelation {
  name: string
  type: string
  target: string
  foreignKey?: boolean
  pivotEntity?: string
}

interface ParsedDmlIndex {
  on: string[]
  where?: string | Record<string, unknown>
  type?: string
  unique?: boolean
  name?: string
}

export interface ParsedDmlEntity {
  name: string
  properties: ParsedDmlProperty[]
  relations?: ParsedDmlRelation[]
  indexes?: ParsedDmlIndex[]
}

/**
 * Parse a raw DML entity definition into a structured format.
 * SPEC-057f step 1.
 */
export function parseDmlEntity(input: unknown): ParsedDmlEntity {
  const raw = input as {
    name: string
    properties?: Array<Record<string, unknown>>
    relations?: Array<Record<string, unknown>>
    indexes?: Array<Record<string, unknown>>
  }
  return {
    name: raw.name,
    properties: (raw.properties ?? []).map((p) => ({
      name: p.name as string,
      type: p.type as string,
      nullable: p.nullable as boolean | undefined,
      computed: p.computed as boolean | undefined,
      default: p.default,
      values: p.values,
    })),
    relations: raw.relations?.map((r) => ({
      name: r.name as string,
      type: r.type as string,
      target: r.target as string,
      foreignKey: r.foreignKey as boolean | undefined,
      pivotEntity: r.pivotEntity as string | undefined,
    })),
    indexes: raw.indexes?.map((i) => ({
      on: i.on as string[],
      where: i.where as string | Record<string, unknown> | undefined,
      type: i.type as string | undefined,
      unique: i.unique as boolean | undefined,
      name: i.name as string | undefined,
    })),
  }
}

/**
 * Serialize a QueryCondition object to a SQL WHERE clause string.
 * Supports $gt, $gte, $lt, $lte, $eq, $ne, $in, $nin operators.
 */
function serializeQueryCondition(condition: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [column, value] of Object.entries(condition)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const ops = value as Record<string, unknown>
      for (const [op, val] of Object.entries(ops)) {
        switch (op) {
          case '$gt': parts.push(`${column} > ${val}`); break
          case '$gte': parts.push(`${column} >= ${val}`); break
          case '$lt': parts.push(`${column} < ${val}`); break
          case '$lte': parts.push(`${column} <= ${val}`); break
          case '$eq':
            if (val === null) parts.push(`${column} IS NULL`)
            else parts.push(`${column} = ${typeof val === 'string' ? `'${val}'` : val}`)
            break
          case '$ne':
            if (val === null) parts.push(`${column} IS NOT NULL`)
            else parts.push(`${column} != ${typeof val === 'string' ? `'${val}'` : val}`)
            break
          case '$in':
            if (Array.isArray(val)) {
              const formatted = val.map((v: unknown) => typeof v === 'string' ? `'${v}'` : v).join(', ')
              parts.push(`${column} IN (${formatted})`)
            }
            break
          case '$nin':
            if (Array.isArray(val)) {
              const formatted = val.map((v: unknown) => typeof v === 'string' ? `'${v}'` : v).join(', ')
              parts.push(`${column} NOT IN (${formatted})`)
            }
            break
        }
      }
    } else {
      if (value === null) parts.push(`${column} IS NULL`)
      else parts.push(`${column} = ${typeof value === 'string' ? `'${value}'` : value}`)
    }
  }
  return parts.join(' AND ')
}

/**
 * Generate a Drizzle-compatible schema from a parsed DML entity.
 * SPEC-057f steps 2-6.
 */
export function generateDrizzleSchema(entity: ParsedDmlEntity): GeneratedSchema {
  const columns: GeneratedSchema['columns'] = {}
  const relations: GeneratedSchema['relations'] = {}
  const indexes: GeneratedSchema['indexes'] = []
  const checks: GeneratedSchema['checks'] = []

  const propertyNames = new Set(entity.properties.map((p) => p.name))

  // Check for implicit column redeclaration (SPEC-057f)
  for (const name of IMPLICIT_COLUMNS) {
    if (propertyNames.has(name)) {
      throw new MantaError('INVALID_DATA', `Property "${name}" is implicit and cannot be redefined in entity "${entity.name}"`)
    }
  }

  // Track shadow columns needed for bigNumber
  const shadowColumns = new Set<string>()

  // Step 2: Generate columns from properties
  for (const prop of entity.properties) {
    // Skip computed properties — no column generated
    if (prop.computed) continue

    const pgType = DML_TYPE_MAP[prop.type] ?? 'TEXT'
    const col: { type: string; notNull?: boolean; default?: unknown } = {
      type: pgType,
      notNull: !prop.nullable ? true : undefined,
    }

    // Handle defaults
    if (prop.default !== undefined) {
      if (prop.type === 'json' && typeof prop.default === 'object') {
        col.default = JSON.stringify(prop.default)
      } else {
        col.default = prop.default
      }
    }

    columns[prop.name] = col

    // bigNumber shadow column (raw_{name} JSONB)
    if (prop.type === 'bigNumber') {
      const shadowName = `raw_${prop.name}`
      // Check for conflict
      if (propertyNames.has(shadowName)) {
        throw new MantaError(
          'INVALID_DATA',
          `Shadow column "${shadowName}" for bigNumber property "${prop.name}" conflicts with existing property in entity "${entity.name}"`,
        )
      }
      if (shadowColumns.has(shadowName)) {
        throw new MantaError('INVALID_DATA', `Duplicate shadow column "${shadowName}" in entity "${entity.name}"`)
      }
      shadowColumns.add(shadowName)
      columns[shadowName] = { type: 'JSONB' }
    }

    // Enum check constraint
    if (prop.type === 'enum' && prop.values) {
      let enumValues: string[]
      if (Array.isArray(prop.values)) {
        enumValues = prop.values as string[]
      } else {
        // Object — extract string values (filter out numeric reverse mappings)
        enumValues = Object.values(prop.values as Record<string, unknown>)
          .filter((v): v is string => typeof v === 'string')
      }
      const valuesStr = enumValues.map((v) => `'${v}'`).join(', ')
      checks.push({
        name: `${entity.name}_${prop.name}_check`,
        expression: `${prop.name} IN (${valuesStr})`,
      })
    }
  }

  // Step 3: Add implicit columns
  columns.id = { type: 'TEXT', notNull: true }
  columns.created_at = { type: 'TIMESTAMPTZ', notNull: true }
  columns.updated_at = { type: 'TIMESTAMPTZ', notNull: true }
  columns.deleted_at = { type: 'TIMESTAMPTZ' }

  // Step 4: Generate relations
  if (entity.relations) {
    for (const rel of entity.relations) {
      relations[rel.name] = { type: rel.type, target: rel.target }

      // hasOne with foreignKey generates FK column on this table
      if ((rel.type === 'hasOne' || rel.type === 'hasOneWithFK') && rel.foreignKey) {
        columns[`${rel.name}_id`] = { type: 'TEXT' }
      }
    }
  }

  // Step 5: Generate indexes
  if (entity.indexes) {
    for (const idx of entity.indexes) {
      let whereClause: string | undefined

      if (idx.where) {
        if (typeof idx.where === 'string') {
          // Explicit string — use as-is, NO implicit soft-delete filter
          whereClause = idx.where
        } else {
          // QueryCondition object — serialize to SQL
          whereClause = serializeQueryCondition(idx.where)
        }
      } else {
        // No explicit where → add implicit soft-delete filter (DG-21, DG-22)
        whereClause = 'deleted_at IS NULL'
      }

      indexes.push({
        name: idx.name ?? `idx_${entity.name.toLowerCase()}_${idx.on.join('_')}`,
        columns: idx.on,
        unique: idx.unique,
        where: whereClause,
        using: idx.type?.toLowerCase(),
      })
    }
  }

  return { columns, relations, indexes, checks }
}
