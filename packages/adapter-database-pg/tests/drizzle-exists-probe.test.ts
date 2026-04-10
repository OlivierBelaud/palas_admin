// Risk #1 probe (unit-level, no PG required)
//
// We use Drizzle's `.toSQL()` on a PgRelationalQuery (returned by findMany
// without awaiting it) to assert that `operators.exists` combined with a
// correlated inner select generates a correlated EXISTS clause where the
// inner WHERE references the outer relational-query alias.
//
// This is the single assumption the F29 rewrite depends on: if Drizzle does
// NOT emit a correlated EXISTS (instead, e.g., binding `fields.id` as a
// literal parameter), we fall back to raw SQL template literals. This probe
// guards that assumption loudly.

import { eq } from 'drizzle-orm'
import { integer, pgTable, text } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import { relations } from 'drizzle-orm/relations'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'

const parents = pgTable('rqprobe_parents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  deleted_at: text('deleted_at'),
})

const children = pgTable('rqprobe_children', {
  id: text('id').primaryKey(),
  parent_id: text('parent_id').notNull(),
  label: text('label').notNull(),
  score: integer('score').notNull().default(0),
  deleted_at: text('deleted_at'),
})

const parentsRelations = relations(parents, ({ many }) => ({
  children: many(children),
}))

const childrenRelations = relations(children, ({ one }) => ({
  parent: one(parents, { fields: [children.parent_id], references: [parents.id] }),
}))

const schema = { parents, children, parentsRelations, childrenRelations }

// Build a schema-aware drizzle client without executing queries.
// postgres() lazily connects on first query execution; toSQL() does not
// execute, so no connection is ever opened.
const sql = postgres('postgres://probe:probe@127.0.0.1:1/probe_offline', { max: 1 })
const db = drizzle(sql, { schema })

describe('Drizzle EXISTS correlation probe (Risk #1, unit-level)', () => {
  it('operators.exists + correlated inner select emits correlated EXISTS referencing the outer alias', () => {
    // biome-ignore lint/suspicious/noExplicitAny: accessing unexecuted PgRelationalQuery for toSQL()
    const q: any = db.query.parents.findMany({
      where: (fields, { exists }) =>
        exists(db.select({ one: children.id }).from(children).where(eq(children.parent_id, fields.id))),
    })

    const { sql: sqlText, params } = q.toSQL() as { sql: string; params: unknown[] }

    // Must be an EXISTS subquery
    expect(sqlText.toLowerCase()).toContain('exists')
    // The inner SELECT must reference the rqprobe_children table
    expect(sqlText).toContain('"rqprobe_children"')
    // The inner WHERE must reference an outer alias, not a bound param.
    // Drizzle assigns a predictable alias of the form "parents" to the
    // root relational query table — verify the inner where qualifies the
    // outer row via a column reference (not a parameter placeholder).
    //
    // Expectation: the inner predicate reads
    //   "rqprobe_children"."parent_id" = "<outer_alias>"."id"
    // rather than
    //   "rqprobe_children"."parent_id" = $N   with fields.id bound as param.
    //
    // Weaker/safer assertion: params must NOT include the literal value of a
    // parent id (since there is none — it is the outer row's column reference).
    expect(params).toEqual([])
    // And the inner where must quote two columns joined by `=`
    // (grep for "parent_id" = "..."."id")
    expect(sqlText).toMatch(/"parent_id"\s*=\s*"[^"]+"\s*\.\s*"id"/)
  })

  it('correlated EXISTS with an additional inner predicate still references outer alias', () => {
    // biome-ignore lint/suspicious/noExplicitAny: accessing unexecuted PgRelationalQuery for toSQL()
    const q: any = db.query.parents.findMany({
      where: (fields, { exists, and }) =>
        exists(
          db
            .select({ one: children.id })
            .from(children)
            .where(and(eq(children.parent_id, fields.id), eq(children.label, 'y'))),
        ),
    })

    const { sql: sqlText, params } = q.toSQL() as { sql: string; params: unknown[] }
    expect(sqlText.toLowerCase()).toContain('exists')
    // Outer correlation still a column = column reference
    expect(sqlText).toMatch(/"parent_id"\s*=\s*"[^"]+"\s*\.\s*"id"/)
    // The literal 'y' must appear as a bound parameter
    expect(params).toEqual(['y'])
  })
})
