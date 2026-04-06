// SPEC-057f — DrizzleSchemaGenerator implements ISchemaGenerator
// Moved from @manta/core/dml/generator to decouple Drizzle from core.

import type { ParsedDmlEntity } from '@manta/core'
import { MantaError } from '@manta/core/errors'
import type { ISchemaGenerator } from '@manta/core/ports'

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

/** Valid SQL identifier pattern — prevents injection in column names used in DDL */
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * Escape a literal value for use in DDL SQL (index WHERE clauses, CHECK constraints).
 *
 * WARNING: This function is ONLY used for schema generation (DDL), NOT for user-facing
 * queries. All runtime queries go through Drizzle ORM's parameterized query builder.
 * Values here come from DML entity definitions (developer-authored code), not user input.
 */
function escapeLiteral(val: unknown): string {
  if (val === null) return 'NULL'
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      throw new MantaError('INVALID_DATA', `Non-finite number in QueryCondition: ${val}`)
    }
    return String(val)
  }
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE'
  if (typeof val === 'string') {
    // Double single quotes to escape (standard SQL escaping for literals)
    return `'${val.replace(/'/g, "''")}'`
  }
  throw new MantaError('INVALID_DATA', `Unsupported value type in QueryCondition: ${typeof val}`)
}

/**
 * Validate that a column name is a safe SQL identifier.
 * Prevents SQL injection through column names in DDL.
 */
function assertSafeColumn(column: string): void {
  if (!SAFE_IDENTIFIER.test(column)) {
    throw new MantaError('INVALID_DATA', `Invalid column name in QueryCondition: "${column}"`)
  }
}

/**
 * Serialize a QueryCondition object to a SQL WHERE clause string for DDL (partial indexes).
 * Supports $gt, $gte, $lt, $lte, $eq, $ne, $in, $nin operators.
 *
 * SECURITY NOTE: This is used ONLY for schema generation (CREATE INDEX ... WHERE).
 * Values come from DML entity definitions (developer code), not from user input.
 * All runtime queries use Drizzle ORM's parameterized query builder.
 */
function serializeQueryCondition(condition: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [column, value] of Object.entries(condition)) {
    assertSafeColumn(column)

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const ops = value as Record<string, unknown>
      for (const [op, val] of Object.entries(ops)) {
        switch (op) {
          case '$gt':
            parts.push(`${column} > ${escapeLiteral(val)}`)
            break
          case '$gte':
            parts.push(`${column} >= ${escapeLiteral(val)}`)
            break
          case '$lt':
            parts.push(`${column} < ${escapeLiteral(val)}`)
            break
          case '$lte':
            parts.push(`${column} <= ${escapeLiteral(val)}`)
            break
          case '$eq':
            if (val === null) parts.push(`${column} IS NULL`)
            else parts.push(`${column} = ${escapeLiteral(val)}`)
            break
          case '$ne':
            if (val === null) parts.push(`${column} IS NOT NULL`)
            else parts.push(`${column} != ${escapeLiteral(val)}`)
            break
          case '$in':
            if (Array.isArray(val)) {
              const formatted = val.map((v: unknown) => escapeLiteral(v)).join(', ')
              parts.push(`${column} IN (${formatted})`)
            }
            break
          case '$nin':
            if (Array.isArray(val)) {
              const formatted = val.map((v: unknown) => escapeLiteral(v)).join(', ')
              parts.push(`${column} NOT IN (${formatted})`)
            }
            break
          default:
            throw new MantaError('INVALID_DATA', `Unknown operator "${op}" in QueryCondition`)
        }
      }
    } else {
      if (value === null) parts.push(`${column} IS NULL`)
      else parts.push(`${column} = ${escapeLiteral(value)}`)
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
      throw new MantaError(
        'INVALID_DATA',
        `Property "${name}" is implicit and cannot be redefined in entity "${entity.name}"`,
      )
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
        enumValues = Object.values(prop.values as Record<string, unknown>).filter(
          (v): v is string => typeof v === 'string',
        )
      }
      const valuesStr = enumValues.map((v) => escapeLiteral(v)).join(', ')
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

/**
 * DrizzleSchemaGenerator — class wrapper implementing ISchemaGenerator.
 */
export class DrizzleSchemaGenerator implements ISchemaGenerator {
  generate(entity: ParsedDmlEntity): GeneratedSchema {
    return generateDrizzleSchema(entity)
  }
}
