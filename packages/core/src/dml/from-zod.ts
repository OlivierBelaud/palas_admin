// fromZodSchema — convert a Zod object schema into DML fields for defineModel()
//
// Enables declaring a model from a Zod schema (typically generated from SDK types via ts-to-zod):
//
//   import { defineModel, fromZodSchema } from '@manta/core'
//   import { postHogEventSchema } from './schemas'
//
//   export default defineModel('PostHogEvent', fromZodSchema(postHogEventSchema)).external()
//
// Zod → DML mapping:
//   z.string()            → field.text()
//   z.number()            → field.number()
//   z.boolean()           → field.boolean()
//   z.date()              → field.dateTime()
//   z.record(...)         → field.json()
//   z.object(...)         → field.json()       (nested objects stored as JSON)
//   z.array(...)          → field.array()
//   z.enum([...])         → field.enum([...])
//   .optional()           → .nullable()        (Manta treats optional and nullable the same at DML level)
//   .nullable()           → .nullable()
//
// Special convention: a field named `id` is marked as primary key.

// biome-ignore lint/suspicious/noExplicitAny: runtime Zod introspection requires dynamic access
type AnyZodSchema = { _def: any; parse?: (v: unknown) => unknown }

import { field } from './model'

/**
 * Convert a Zod object schema into a DML field record compatible with defineModel().
 *
 * @param schema — a `z.object({ ... })` schema (typically generated from SDK types via ts-to-zod)
 * @returns a field record ready to pass to `defineModel(name, fields)`
 */
export function fromZodSchema(schema: AnyZodSchema): Record<string, unknown> {
  const def = schema._def
  if (def?.typeName !== 'ZodObject' && !def?.shape) {
    throw new Error('fromZodSchema() expects a z.object({...}) schema')
  }
  // Zod v3 stores shape as a function; Zod v4 as an object
  const shape = typeof def.shape === 'function' ? def.shape() : def.shape
  const fields: Record<string, unknown> = {}

  for (const [key, zodType] of Object.entries(shape as Record<string, AnyZodSchema>)) {
    let dmlField = convertZodToDmlField(zodType)
    // Convention: `id` is the primary key
    if (key === 'id' && typeof (dmlField as { primaryKey?: () => unknown }).primaryKey === 'function') {
      dmlField = (dmlField as { primaryKey: () => unknown }).primaryKey()
    }
    fields[key] = dmlField
  }

  return fields
}

function convertZodToDmlField(zodType: AnyZodSchema): unknown {
  const def = zodType._def
  if (!def) throw new Error('Invalid Zod type (missing _def)')

  const typeName = def.typeName as string

  // Unwrap Optional / Nullable / Default — treat as nullable at DML level
  if (typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault') {
    const inner = convertZodToDmlField(def.innerType)
    return (inner as { nullable?: () => unknown }).nullable?.() ?? inner
  }

  switch (typeName) {
    case 'ZodString':
      return field.text()
    case 'ZodNumber':
      return field.number()
    case 'ZodBoolean':
      return field.boolean()
    case 'ZodDate':
      return field.dateTime()
    case 'ZodEnum':
      return field.enum(def.values as readonly string[])
    case 'ZodArray':
      return field.array()
    case 'ZodRecord':
    case 'ZodObject':
    case 'ZodAny':
    case 'ZodUnknown':
      return field.json()
    default:
      // Fallback: JSON for anything we don't explicitly handle (unions, intersections, etc.)
      return field.json()
  }
}
