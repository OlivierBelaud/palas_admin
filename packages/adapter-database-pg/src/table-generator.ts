// Auto-generate Drizzle pgTable objects from DML entities at runtime.
// No hardcoded tables — everything comes from defineModel() + defineLink().

import type { PgTable } from 'drizzle-orm/pg-core'
import { index, integer, jsonb, pgTable, real, serial, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Property metadata from DmlEntity.schema[field].parse(fieldName).
 */
interface PropertyMeta {
  fieldName: string
  dataType: { name: string; options?: Record<string, unknown> }
  nullable: boolean
  primaryKey: boolean
  computed: boolean
  defaultValue?: unknown
  unique?: boolean | string
}

/**
 * Convert a DML property type to a Drizzle column builder.
 */
interface DrizzleColumnLike {
  notNull: () => DrizzleColumnLike
  default: (value: unknown) => DrizzleColumnLike
  unique: () => DrizzleColumnLike
  primaryKey: () => DrizzleColumnLike
}

function dmlTypeToDrizzle(meta: PropertyMeta): DrizzleColumnLike {
  const name = meta.fieldName
  switch (meta.dataType.name) {
    case 'id':
      return text(name).primaryKey() as unknown as DrizzleColumnLike
    case 'text':
      return text(name) as unknown as DrizzleColumnLike
    case 'number':
      return integer(name) as unknown as DrizzleColumnLike
    case 'boolean': {
      const { boolean: pgBoolean } = require('drizzle-orm/pg-core')
      return pgBoolean(name) as DrizzleColumnLike
    }
    case 'float':
      return real(name) as unknown as DrizzleColumnLike
    case 'bigNumber':
      return text(name) as unknown as DrizzleColumnLike // NUMERIC as text for precision
    case 'serial':
      return serial(name) as unknown as DrizzleColumnLike
    case 'dateTime':
      return timestamp(name, { withTimezone: true }) as unknown as DrizzleColumnLike
    case 'json':
      return jsonb(name) as unknown as DrizzleColumnLike
    case 'enum':
      return text(name) as unknown as DrizzleColumnLike // Enums stored as TEXT with CHECK constraint
    case 'array':
      return jsonb(name) as unknown as DrizzleColumnLike
    default:
      return text(name) as unknown as DrizzleColumnLike
  }
}

/**
 * Pluralize an entity name for the table name.
 * Product → products, InventoryItem → inventory_items
 */
function entityToTableName(entityName: string): string {
  // Convert PascalCase to snake_case
  const snake = entityName.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
  if (snake.endsWith('s') || snake.endsWith('x') || snake.endsWith('ch') || snake.endsWith('sh')) return `${snake}es`
  if (snake.endsWith('y') && !/[aeiou]y$/i.test(snake)) return `${snake.slice(0, -1)}ies`
  return `${snake}s`
}

/**
 * Generate a Drizzle pgTable from a DML entity at runtime.
 * Reads the entity schema, parses each property, and creates column definitions.
 *
 * @param entity - A DmlEntity instance (output of defineModel())
 * @returns { tableName, table } — the Drizzle pgTable ready for queries
 */
export function generatePgTableFromDml(entity: { name: string; schema: Record<string, unknown> }): {
  tableName: string
  table: PgTable
} {
  const columns: Record<string, unknown> = {}

  for (const [fieldName, value] of Object.entries(entity.schema)) {
    const v = value as Record<string, unknown>

    // Skip relations — they don't generate columns
    if (v?.__dmlRelation === true) continue

    // Property — has .parse() method
    if (typeof v?.parse === 'function') {
      try {
        const meta = v.parse(fieldName) as PropertyMeta
        if (meta.computed) continue // computed fields have no column

        let col = dmlTypeToDrizzle(meta)

        // Apply notNull (skip for id — already handled)
        if (!meta.nullable && meta.dataType.name !== 'id') {
          col = col.notNull()
        }

        // Apply default
        if (meta.defaultValue !== undefined) {
          col = col.default(meta.defaultValue)
        }

        // Apply unique
        if (meta.unique) {
          col = col.unique()
        }

        columns[fieldName] = col
      } catch {
        columns[fieldName] = text(fieldName)
      }
    }
  }

  // Implicit columns — always present on every entity (ISO Medusa DML).
  // The user never defines these — the framework adds them automatically.
  if (!columns.id) columns.id = text('id').primaryKey()
  if (!columns.metadata) columns.metadata = jsonb('metadata')
  if (!columns.created_at) columns.created_at = timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  if (!columns.updated_at) columns.updated_at = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  if (!columns.deleted_at) columns.deleted_at = timestamp('deleted_at', { withTimezone: true })

  const tableName = entityToTableName(entity.name)
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle pgTable accepts dynamic column records that don't type-check against its strict generic constraints
  const table = pgTable(tableName, columns as any)

  return { tableName, table }
}

/**
 * Generate a Drizzle pgTable for a link pivot table.
 *
 * @param link - A ResolvedLink from defineLink()
 * @returns { tableName, table } — the Drizzle pgTable for the pivot
 */
export function generateLinkPgTable(link: {
  tableName: string
  leftFk: string
  rightFk: string
  extraColumns?: Record<string, unknown>
}): {
  tableName: string
  table: PgTable
} {
  const { tableName, leftFk, rightFk } = link

  const columns: Record<string, unknown> = {
    id: text('id').primaryKey(),
    [leftFk]: text(leftFk).notNull(),
    [rightFk]: text(rightFk).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  }

  // Add extra columns from defineLink() extraColumns
  if (link.extraColumns) {
    for (const [fieldName, fieldValue] of Object.entries(link.extraColumns)) {
      const v = fieldValue as Record<string, unknown>
      if (typeof v?.parse === 'function') {
        try {
          const meta = v.parse(fieldName) as PropertyMeta
          let col = dmlTypeToDrizzle(meta)

          if (!meta.nullable && meta.dataType.name !== 'id') {
            col = col.notNull()
          }
          if (meta.defaultValue !== undefined) {
            col = col.default(meta.defaultValue)
          }
          if (meta.unique) {
            col = col.unique()
          }

          columns[fieldName] = col
        } catch {
          columns[fieldName] = text(fieldName)
        }
      } else {
        // Fallback for non-DML fields (e.g. Medusa plugin)
        columns[fieldName] = text(fieldName)
      }
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Drizzle pgTable accepts dynamic column records that don't type-check against its strict generic constraints
  const table = pgTable(tableName, columns as any, (t) => ({
    idx_left: index(`idx_${tableName}_${leftFk}`).on((t as unknown as Record<string, ReturnType<typeof text>>)[leftFk]),
    idx_right: index(`idx_${tableName}_${rightFk}`).on(
      (t as unknown as Record<string, ReturnType<typeof text>>)[rightFk],
    ),
  }))

  return { tableName, table }
}
