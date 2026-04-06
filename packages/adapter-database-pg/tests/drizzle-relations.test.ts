// Integration test — verifies that buildDrizzleRelations() produces real Drizzle relations()
// that are compatible with drizzle(sql, { schema }) and db.query.*.findMany({ with: ... })
//
// Uses actual Drizzle pgTable + relations definitions (no PG connection needed).

import { createTableRelationsHelpers, extractTablesRelationalConfig, relations } from 'drizzle-orm'
import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import type { EntityRelationInput } from '../src/relation-generator'
import { buildDrizzleRelations, generateIntraModuleRelations, generateLinkRelations } from '../src/relation-generator'

// ── Real Drizzle tables ─────────────────────────────────────────────

const products = pgTable('products', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  status: text('status').notNull().default('draft'),
  category_id: text('category_id'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
})

const variants = pgTable('variants', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull(),
  price: integer('price').notNull().default(0),
  product_id: text('product_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
})

const categories = pgTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
})

const tags = pgTable('tags', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
})

const product_tags = pgTable('product_tags', {
  id: text('id').primaryKey(),
  products_id: text('products_id').notNull(),
  tags_id: text('tags_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
})

const collections = pgTable('collections', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
})

const product_collection_link = pgTable('product_collection_link', {
  id: text('id').primaryKey(),
  product_id: text('product_id').notNull(),
  collection_id: text('collection_id').notNull(),
})

// ── Table map ───────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: mixed table types
const tableMap: Record<string, any> = {
  products,
  variants,
  categories,
  tags,
  product_tags,
  product_collection_link,
  product: products,
  collection: collections,
  collections,
}

// ── Tests ───────────────────────────────────────────────────────────

describe('buildDrizzleRelations — real Drizzle integration', () => {
  it('produces Relations instances with correct table reference', () => {
    const entities: EntityRelationInput[] = [
      {
        entityName: 'Product',
        tableName: 'products',
        relations: [{ name: 'variants', type: 'hasMany', target: 'Variant' }],
      },
      {
        entityName: 'Variant',
        tableName: 'variants',
        relations: [{ name: 'product', type: 'belongsTo', target: 'Product' }],
      },
    ]

    const defs = generateIntraModuleRelations(entities)
    const result = buildDrizzleRelations(defs, tableMap)

    expect(result).toHaveProperty('productsRelations')
    expect(result).toHaveProperty('variantsRelations')

    // biome-ignore lint/suspicious/noExplicitAny: Drizzle Relations shape
    const prodRels = result.productsRelations as any
    expect(prodRels.table).toBe(products)
    expect(typeof prodRels.config).toBe('function')

    // biome-ignore lint/suspicious/noExplicitAny: Drizzle Relations shape
    const varRels = result.variantsRelations as any
    expect(varRels.table).toBe(variants)
    expect(typeof varRels.config).toBe('function')
  })

  it('generated Relations are same class as manual relations()', () => {
    const manualRels = relations(products, ({ many }) => ({
      variants: many(variants),
    }))

    const entities: EntityRelationInput[] = [
      {
        entityName: 'Product',
        tableName: 'products',
        relations: [{ name: 'variants', type: 'hasMany', target: 'Variant' }],
      },
      { entityName: 'Variant', tableName: 'variants', relations: [] },
    ]

    const defs = generateIntraModuleRelations(entities)
    const result = buildDrizzleRelations(defs, tableMap)

    // Same constructor = same Drizzle Relations class
    expect(result.productsRelations!.constructor).toBe(manualRels.constructor)
  })

  it('schema with generated relations passes extractTablesRelationalConfig', () => {
    const entities: EntityRelationInput[] = [
      {
        entityName: 'Product',
        tableName: 'products',
        relations: [
          { name: 'variants', type: 'hasMany', target: 'Variant' },
          { name: 'category', type: 'belongsTo', target: 'Category' },
        ],
      },
      {
        entityName: 'Variant',
        tableName: 'variants',
        relations: [{ name: 'product', type: 'belongsTo', target: 'Product' }],
      },
      {
        entityName: 'Category',
        tableName: 'categories',
        relations: [{ name: 'products', type: 'hasMany', target: 'Product' }],
      },
    ]

    const defs = generateIntraModuleRelations(entities)
    const drizzleRelations = buildDrizzleRelations(defs, tableMap)

    // Assemble full schema like drizzle(sql, { schema })
    const schema = {
      products,
      variants,
      categories,
      ...drizzleRelations,
    }

    // This is what Drizzle internally calls to validate the schema
    // If it doesn't throw, the schema is valid
    const result = extractTablesRelationalConfig(schema, createTableRelationsHelpers)

    // Verify tables were extracted
    expect(result.tables).toHaveProperty('products')
    expect(result.tables).toHaveProperty('variants')
    expect(result.tables).toHaveProperty('categories')

    // Verify relations were resolved
    const productsConfig = result.tables.products
    expect(productsConfig.relations).toHaveProperty('variants')
    expect(productsConfig.relations).toHaveProperty('category')

    const variantsConfig = result.tables.variants
    expect(variantsConfig.relations).toHaveProperty('product')

    const categoriesConfig = result.tables.categories
    expect(categoriesConfig.relations).toHaveProperty('products')
  })

  it('belongsTo generates one() with correct FK columns', () => {
    const entities: EntityRelationInput[] = [
      {
        entityName: 'Variant',
        tableName: 'variants',
        relations: [{ name: 'product', type: 'belongsTo', target: 'Product' }],
      },
      { entityName: 'Product', tableName: 'products', relations: [] },
    ]

    const defs = generateIntraModuleRelations(entities)
    const drizzleRelations = buildDrizzleRelations(defs, tableMap)
    const schema = { products, variants, ...drizzleRelations }
    const result = extractTablesRelationalConfig(schema, createTableRelationsHelpers)

    // The 'product' relation on variants should be a One relation
    const productRel = result.tables.variants.relations.product
    expect(productRel.referencedTableName).toBe('products')
    // One relations have a config with fields/references
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle internal
    const config = (productRel as any).config
    expect(config).toBeDefined()
    expect(config.fields).toHaveLength(1)
    expect(config.references).toHaveLength(1)
  })

  it('hasMany generates many() relation', () => {
    const entities: EntityRelationInput[] = [
      {
        entityName: 'Product',
        tableName: 'products',
        relations: [{ name: 'variants', type: 'hasMany', target: 'Variant' }],
      },
      { entityName: 'Variant', tableName: 'variants', relations: [] },
    ]

    const defs = generateIntraModuleRelations(entities)
    const drizzleRelations = buildDrizzleRelations(defs, tableMap)
    const schema = { products, variants, ...drizzleRelations }
    const result = extractTablesRelationalConfig(schema, createTableRelationsHelpers)

    const variantsRel = result.tables.products.relations.variants
    expect(variantsRel.referencedTableName).toBe('variants')
    // Many relations don't have fields/references
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle internal
    expect((variantsRel as any).config).toBeUndefined()
  })

  it('manyToMany generates pivot table relations', () => {
    const entities: EntityRelationInput[] = [
      {
        entityName: 'Product',
        tableName: 'products',
        relations: [{ name: 'tags', type: 'manyToMany', target: 'Tag', pivotEntity: 'product_tags' }],
      },
      { entityName: 'Tag', tableName: 'tags', relations: [] },
    ]

    const defs = generateIntraModuleRelations(entities)
    const drizzleRelations = buildDrizzleRelations(defs, tableMap)
    const schema = { products, tags, product_tags, ...drizzleRelations }
    const result = extractTablesRelationalConfig(schema, createTableRelationsHelpers)

    // Products → many(product_tags)
    const tagsRel = result.tables.products.relations.tags
    expect(tagsRel.referencedTableName).toBe('product_tags')

    // Pivot table → one(products) + one(tags)
    expect(result.tables.product_tags.relations).toHaveProperty('products')
    expect(result.tables.product_tags.relations).toHaveProperty('tags')
    expect(result.tables.product_tags.relations.products.referencedTableName).toBe('products')
    expect(result.tables.product_tags.relations.tags.referencedTableName).toBe('tags')
  })

  it('cross-module links generate pivot relations', () => {
    const links = [
      {
        __type: 'link' as const,
        leftModule: 'product',
        leftEntity: 'Product',
        rightModule: 'collection',
        rightEntity: 'Collection',
        tableName: 'product_collection_link',
        leftFk: 'product_id',
        rightFk: 'collection_id',
        cardinality: 'M:N' as const,
        cascadeLeft: false,
        cascadeRight: false,
      },
    ] as const

    const defs = generateLinkRelations(links)
    const drizzleRelations = buildDrizzleRelations(defs, tableMap)
    const schema = { products, collections, product_collection_link, ...drizzleRelations }
    const result = extractTablesRelationalConfig(schema, createTableRelationsHelpers)

    // Pivot → one(product) + one(collection)
    expect(result.tables.product_collection_link.relations).toHaveProperty('product')
    expect(result.tables.product_collection_link.relations).toHaveProperty('collection')
    expect(result.tables.product_collection_link.relations.product.referencedTableName).toBe('products')
    expect(result.tables.product_collection_link.relations.collection.referencedTableName).toBe('collections')

    // Products → many(pivot)
    expect(result.tables.products.relations).toHaveProperty('link_product_collection_link')
  })

  it('combined intra + cross module schema passes full validation', () => {
    const entities: EntityRelationInput[] = [
      {
        entityName: 'Product',
        tableName: 'products',
        relations: [
          { name: 'variants', type: 'hasMany', target: 'Variant' },
          { name: 'category', type: 'belongsTo', target: 'Category' },
        ],
      },
      {
        entityName: 'Variant',
        tableName: 'variants',
        relations: [{ name: 'product', type: 'belongsTo', target: 'Product' }],
      },
      {
        entityName: 'Category',
        tableName: 'categories',
        relations: [{ name: 'products', type: 'hasMany', target: 'Product' }],
      },
    ]

    const links = [
      {
        __type: 'link' as const,
        leftModule: 'product',
        leftEntity: 'Product',
        rightModule: 'collection',
        rightEntity: 'Collection',
        tableName: 'product_collection_link',
        leftFk: 'product_id',
        rightFk: 'collection_id',
        cardinality: 'M:N' as const,
        cascadeLeft: false,
        cascadeRight: false,
      },
    ] as const

    const intraDefs = generateIntraModuleRelations(entities)
    const linkDefs = generateLinkRelations(links)
    const allDefs = [...intraDefs, ...linkDefs]
    const drizzleRelations = buildDrizzleRelations(allDefs, tableMap)

    const schema = {
      products,
      variants,
      categories,
      collections,
      product_collection_link,
      ...drizzleRelations,
    }

    // Full validation — this is exactly what drizzle(sql, { schema }) does internally
    const result = extractTablesRelationalConfig(schema, createTableRelationsHelpers)

    // All tables present
    expect(Object.keys(result.tables)).toContain('products')
    expect(Object.keys(result.tables)).toContain('variants')
    expect(Object.keys(result.tables)).toContain('categories')
    expect(Object.keys(result.tables)).toContain('collections')
    expect(Object.keys(result.tables)).toContain('product_collection_link')

    // Products has: variants (many), category (one), link_pivot (many)
    const prodRels = Object.keys(result.tables.products.relations)
    expect(prodRels).toContain('variants')
    expect(prodRels).toContain('category')
    expect(prodRels).toContain('link_product_collection_link')

    // Variants has: product (one)
    expect(Object.keys(result.tables.variants.relations)).toContain('product')

    // Categories has: products (many)
    expect(Object.keys(result.tables.categories.relations)).toContain('products')

    // Pivot has: product (one), collection (one)
    const pivotRels = Object.keys(result.tables.product_collection_link.relations)
    expect(pivotRels).toContain('product')
    expect(pivotRels).toContain('collection')

    // Table names map exists and has entries
    expect(Object.keys(result.tableNamesMap).length).toBeGreaterThan(0)
  })
})
