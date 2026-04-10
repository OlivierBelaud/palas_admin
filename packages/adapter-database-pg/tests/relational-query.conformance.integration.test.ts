// IRelationalQueryPort conformance — DrizzleRelationalQuery adapter.
//
// Thin wrapper over the shared conformance suite in
// `@manta/core/testing/relational-query-suite`. Uses the real PostgreSQL
// test database — guarded by TEST_DATABASE_URL and skipped gracefully in
// environments without a running PG.
//
// Excluded from default `vitest run` via the repo-wide
// `**/*.integration.test.*` pattern; runs under `pnpm test:integration` or
// under `check:runtime`.

import { runRelationalQueryConformance, type SeedData } from '@manta/core/testing/relational-query-suite'
import { createTestDatabase } from '@manta/test-utils/pg'
import { integer, pgTable, text } from 'drizzle-orm/pg-core'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { relations } from 'drizzle-orm/relations'
import postgres from 'postgres'
import { DrizzleRelationalQuery } from '../src/relational-query'

// ── Tables + relations matching the canonical suite seed ─────────────

const products = pgTable('products', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  status: text('status').notNull().default('draft'),
  price: integer('price').notNull().default(0),
  deleted_at: text('deleted_at'),
})

const variants = pgTable('variants', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull(),
  price: integer('price').notNull().default(0),
  product_id: text('product_id').notNull(),
  deleted_at: text('deleted_at'),
})

const categories = pgTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  deleted_at: text('deleted_at'),
})

const productCategories = pgTable('product_categories', {
  id: text('id').primaryKey(),
  product_id: text('product_id').notNull(),
  category_id: text('category_id').notNull(),
})

const productsRelations = relations(products, ({ many }) => ({
  variants: many(variants),
  productCategories: many(productCategories),
}))
const variantsRelations = relations(variants, ({ one }) => ({
  product: one(products, { fields: [variants.product_id], references: [products.id] }),
}))
const categoriesRelations = relations(categories, ({ many }) => ({
  productCategories: many(productCategories),
}))
const productCategoriesRelations = relations(productCategories, ({ one }) => ({
  product: one(products, { fields: [productCategories.product_id], references: [products.id] }),
  category: one(categories, { fields: [productCategories.category_id], references: [categories.id] }),
}))

const schema = {
  products,
  variants,
  categories,
  product_categories: productCategories,
  productsRelations,
  variantsRelations,
  categoriesRelations,
  productCategoriesRelations,
}

// ── Runner ───────────────────────────────────────────────────────────

runRelationalQueryConformance({
  name: 'DrizzleRelationalQuery (postgres)',
  create: async () => {
    const { url, cleanup } = await createTestDatabase()
    const sql = postgres(url, { max: 3 })
    const db: PostgresJsDatabase<typeof schema> = drizzle(sql, { schema })

    // The suite uses singular entity names ('product', 'variant', 'category').
    // Register a relation-alias-less DrizzleRelationalQuery — the existing
    // entity-key resolver in the adapter already normalizes singular →
    // plural → table key, so `product` resolves to the `products` query.
    //
    // Note: the suite's seed uses `product_category` as the pivot entity
    // name. We rename relation keys on the `product` entity via a simple
    // alias so that `categories` routes through `productCategories.category`.
    const relationAliases = new Map<string, Record<string, import('../src/relational-query').RelationAliasEntry>>([
      [
        'product',
        {
          // 'categories' → M:N through pivot productCategories → category
          categories: { pivot: 'productCategories', through: 'category' },
        },
      ],
    ])
    const rq = new DrizzleRelationalQuery(db, { relationAliases })

    await sql`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        price INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS variants (
        id TEXT PRIMARY KEY,
        sku TEXT NOT NULL,
        price INTEGER NOT NULL DEFAULT 0,
        product_id TEXT NOT NULL,
        deleted_at TEXT
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        deleted_at TEXT
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS product_categories (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        category_id TEXT NOT NULL
      )
    `

    return {
      rq,
      seed: async (data: SeedData) => {
        // biome-ignore lint/suspicious/noExplicitAny: dynamic row shapes
        await db.insert(products).values(data.products.rows as any)
        // biome-ignore lint/suspicious/noExplicitAny: dynamic row shapes
        await db.insert(variants).values(data.variants.rows as any)
        // biome-ignore lint/suspicious/noExplicitAny: dynamic row shapes
        await db.insert(categories).values(data.categories.rows as any)
        // biome-ignore lint/suspicious/noExplicitAny: dynamic row shapes
        await db.insert(productCategories).values(data.product_categories.rows as any)
      },
      teardown: async () => {
        await sql.end()
        await cleanup()
      },
    }
  },
})
