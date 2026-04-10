// Risk #2b probe — verify normalizeRelation returns the join columns we need
// for both One (belongsTo) and Many (hasMany) relations.

import { normalizeRelation } from 'drizzle-orm'
import { pgTable, text } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import { relations } from 'drizzle-orm/relations'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'

const parents = pgTable('p', { id: text('id').primaryKey() })
const children = pgTable('c', {
  id: text('id').primaryKey(),
  parent_id: text('parent_id').notNull(),
})

const pr = relations(parents, ({ many }) => ({ children: many(children) }))
const cr = relations(children, ({ one }) => ({
  parent: one(parents, { fields: [children.parent_id], references: [parents.id] }),
}))

describe('Drizzle normalizeRelation probe', () => {
  it('returns fields/references for Many (hasMany) — derives from reciprocal One', () => {
    const sql = postgres('postgres://x:x@127.0.0.1:1/x', { max: 1 })
    const db = drizzle(sql, { schema: { parents, children, pr, cr } })
    // biome-ignore lint/suspicious/noExplicitAny: runtime probing
    const meta = (db as any)._
    const manyRel = meta.schema.parents.relations.children
    const norm = normalizeRelation(meta.schema, meta.tableNamesMap, manyRel)

    expect(norm.fields).toHaveLength(1)
    expect(norm.references).toHaveLength(1)
    // For a Many, `fields` are on the source (parents) and `references` are on the target (children).
    // Concretely: parents.id → children.parent_id.
    // biome-ignore lint/suspicious/noExplicitAny: probe dynamic access
    const fieldCol = norm.fields[0] as any
    // biome-ignore lint/suspicious/noExplicitAny: probe dynamic access
    const refCol = norm.references[0] as any
    expect(fieldCol.name).toBe('id')
    expect(refCol.name).toBe('parent_id')
  })

  it('returns fields/references for One (belongsTo) with explicit config', () => {
    const sql = postgres('postgres://x:x@127.0.0.1:1/x', { max: 1 })
    const db = drizzle(sql, { schema: { parents, children, pr, cr } })
    // biome-ignore lint/suspicious/noExplicitAny: runtime probing
    const meta = (db as any)._
    const oneRel = meta.schema.children.relations.parent
    const norm = normalizeRelation(meta.schema, meta.tableNamesMap, oneRel)

    // For a One, `fields` are on the source (children) and `references` are on the target (parents).
    // biome-ignore lint/suspicious/noExplicitAny: probe dynamic access
    const fieldCol = norm.fields[0] as any
    // biome-ignore lint/suspicious/noExplicitAny: probe dynamic access
    const refCol = norm.references[0] as any
    expect(fieldCol.name).toBe('parent_id')
    expect(refCol.name).toBe('id')
  })
})
