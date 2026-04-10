// Risk #2 probe — verify the shape of `db._` on a schema-aware drizzle client.
// We need to know whether `db._.schema` is populated (as a TablesRelationalConfig)
// so the rewrite can introspect relation metadata without re-parsing the schema.

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

describe('Drizzle db._.schema shape probe (Risk #2)', () => {
  it('db._.schema, db._.fullSchema, db._.tableNamesMap are populated by drizzle(sql, { schema })', () => {
    const sql = postgres('postgres://x:x@127.0.0.1:1/x', { max: 1 })
    const db = drizzle(sql, { schema: { parents, children, pr, cr } })
    // biome-ignore lint/suspicious/noExplicitAny: probe runtime shape
    const meta = (db as any)._

    expect(meta).toBeDefined()
    expect(meta.schema).toBeDefined()
    expect(meta.fullSchema).toBeDefined()
    expect(meta.tableNamesMap).toBeDefined()

    // schema is a TablesRelationalConfig keyed by drizzle-normalized table names
    const schemaKeys = Object.keys(meta.schema)
    expect(schemaKeys).toContain('parents')
    expect(schemaKeys).toContain('children')

    // Each entry exposes the relations it has
    const parentsEntry = meta.schema.parents
    expect(parentsEntry.relations).toBeDefined()
    expect(parentsEntry.relations.children).toBeDefined()
    // The referenced table name is the physical table
    expect(parentsEntry.relations.children.referencedTableName).toBe('c')

    const childrenEntry = meta.schema.children
    expect(childrenEntry.relations.parent).toBeDefined()
    expect(childrenEntry.relations.parent.referencedTableName).toBe('p')
  })
})
