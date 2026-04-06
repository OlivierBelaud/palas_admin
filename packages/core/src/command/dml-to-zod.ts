// dmlToZod — Convert a DML entity schema to Zod schemas for auto-generated commands.
//
// Given a DmlEntity, produces:
//   createSchema  — required fields required, nullable fields optional
//   updateSchema  — all fields optional + required `id`
//
// Implicit fields (id, created_at, updated_at, deleted_at) are excluded from create input.

import { z } from 'zod'
import type { DmlEntity } from '../dml/entity'
import { DmlEntity as DmlEntityClass } from '../dml/entity'

const IMPLICIT_FIELDS = new Set(['id', 'metadata', 'created_at', 'updated_at', 'deleted_at'])

/**
 * Map a DML property dataType.name to a Zod type.
 */
function propertyToZod(meta: {
  dataType: { name: string; options?: Record<string, unknown> }
  nullable: boolean
  values?: unknown
  defaultValue?: unknown
}): z.ZodType {
  let schema: z.ZodType

  switch (meta.dataType.name) {
    case 'text':
      schema = z.string()
      break
    case 'number':
    case 'float':
    case 'bigNumber':
    case 'autoIncrement':
      schema = z.number()
      break
    case 'boolean':
      schema = z.boolean()
      break
    case 'dateTime':
      schema = z.string().datetime().or(z.date())
      break
    case 'json':
      schema = z.unknown()
      break
    case 'enum': {
      const values = (meta.values ?? meta.dataType.options?.values) as readonly [string, ...string[]] | undefined
      if (values && values.length > 0) {
        schema = z.enum(values as [string, ...string[]])
      } else {
        schema = z.string()
      }
      break
    }
    case 'array':
      schema = z.array(z.unknown())
      break
    default:
      schema = z.unknown()
  }

  if (meta.nullable) {
    schema = schema.nullable()
  }

  return schema
}

/**
 * Parse a DmlEntity schema into field metadata.
 * Handles both DmlPropertyDefinition objects (with parse()) and DmlRelationDefinition objects.
 */
function parseEntityFields(entity: DmlEntity): Array<{
  fieldName: string
  zodType: z.ZodType
  nullable: boolean
  hasDefault: boolean
}> {
  const fields: Array<{
    fieldName: string
    zodType: z.ZodType
    nullable: boolean
    hasDefault: boolean
  }> = []

  for (const [key, value] of Object.entries(entity.schema)) {
    if (IMPLICIT_FIELDS.has(key)) continue

    // Skip relations
    if (DmlEntityClass.isRelation(value)) continue

    // Parse property metadata
    if (typeof (value as { parse?: unknown }).parse === 'function') {
      const meta = (
        value as {
          parse: (name: string) => {
            dataType: { name: string; options?: Record<string, unknown> }
            nullable: boolean
            values?: unknown
            defaultValue?: unknown
            computed: boolean
          }
        }
      ).parse(key)

      // Skip computed properties (not stored)
      if (meta.computed) continue

      fields.push({
        fieldName: key,
        zodType: propertyToZod(meta),
        nullable: meta.nullable,
        hasDefault: meta.defaultValue !== undefined,
      })
    }
  }

  return fields
}

export interface EntityZodSchemas {
  /** Zod schema for create input — required fields required, nullable/default fields optional */
  create: z.ZodObject<Record<string, z.ZodType>>
  /** Zod schema for update input — all fields optional + required `id` */
  update: z.ZodObject<Record<string, z.ZodType>>
  /** Zod schema for delete input — just `id` (or `ids` for bulk) */
  delete: z.ZodObject<Record<string, z.ZodType>>
  /** Zod schema for retrieve input — just `id` */
  retrieve: z.ZodObject<Record<string, z.ZodType>>
  /** Zod schema for list input — filters + pagination */
  list: z.ZodObject<Record<string, z.ZodType>>
}

/**
 * Generate Zod schemas from a DML entity for auto-generated commands.
 *
 * @example
 * ```typescript
 * const Product = defineModel('Product', {
 *   title: field.text(),
 *   price: field.number(),
 *   status: field.enum(['draft', 'active']),
 *   description: field.text().nullable(),
 * })
 *
 * const schemas = dmlToZod(Product)
 * // schemas.create → z.object({ title: z.string(), price: z.number(), status: z.enum([...]), description: z.string().nullable().optional() })
 * // schemas.update → z.object({ id: z.string(), title: z.string().optional(), ... })
 * // schemas.delete → z.object({ id: z.string() })
 * ```
 */
export function dmlToZod(entity: DmlEntity): EntityZodSchemas {
  const fields = parseEntityFields(entity)

  // --- Create schema ---
  const createShape: Record<string, z.ZodType> = {}
  for (const f of fields) {
    if (f.nullable || f.hasDefault) {
      // Nullable or has default → optional in create
      createShape[f.fieldName] = f.zodType.optional()
    } else {
      // Required
      createShape[f.fieldName] = f.zodType
    }
  }
  const create = z.object(createShape)

  // --- Update schema ---
  const updateShape: Record<string, z.ZodType> = { id: z.string() }
  for (const f of fields) {
    updateShape[f.fieldName] = f.zodType.optional()
  }
  const update = z.object(updateShape)

  // --- Delete schema ---
  const del = z.object({
    id: z.string(),
  })

  // --- Retrieve schema ---
  const retrieve = z.object({
    id: z.string(),
  })

  // --- List schema ---
  const list = z.object({
    filters: z.record(z.unknown()).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    offset: z.number().int().min(0).optional(),
    order: z.record(z.enum(['ASC', 'DESC'])).optional(),
  })

  return { create, update, delete: del, retrieve, list }
}
