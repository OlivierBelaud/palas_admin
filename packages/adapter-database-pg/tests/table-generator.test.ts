// TG-01 → TG-10 — table-generator: generatePgTableFromDml + generateLinkPgTable unit tests

import { describe, expect, it } from 'vitest'
import { generateLinkPgTable, generatePgTableFromDml } from '../src/table-generator'

// Helper: create a DML-like field mock with .parse() returning PropertyMeta
function mockDmlField(dataType: string, opts?: { nullable?: boolean; defaultValue?: unknown; unique?: boolean }) {
  return {
    parse: (fieldName: string) => ({
      fieldName,
      dataType: { name: dataType },
      nullable: opts?.nullable ?? false,
      primaryKey: false,
      computed: false,
      defaultValue: opts?.defaultValue,
      unique: opts?.unique,
    }),
  }
}

// ── generateLinkPgTable ────────────────────────────────────────

describe('generateLinkPgTable', () => {
  // TG-01 — Basic link table without extra columns
  it('TG-01 — generates a link table with FK columns and indexes', () => {
    const result = generateLinkPgTable({
      tableName: 'product_collection',
      leftFk: 'product_id',
      rightFk: 'collection_id',
    })

    expect(result.tableName).toBe('product_collection')
    expect(result.table).toBeDefined()

    // Drizzle pgTable columns are accessible as properties
    const cols = Object.keys(result.table as unknown as Record<string, unknown>)
    expect(cols).toContain('id')
    expect(cols).toContain('product_id')
    expect(cols).toContain('collection_id')
    expect(cols).toContain('created_at')
    expect(cols).toContain('updated_at')
    expect(cols).toContain('deleted_at')
  })

  // TG-02 — Link table with text extra column
  it('TG-02 — includes a text extra column from DML field', () => {
    const result = generateLinkPgTable({
      tableName: 'product_tag',
      leftFk: 'product_id',
      rightFk: 'tag_id',
      extraColumns: {
        label: mockDmlField('text'),
      },
    })

    const cols = Object.keys(result.table as unknown as Record<string, unknown>)
    expect(cols).toContain('label')
  })

  // TG-03 — Link table with number extra column
  it('TG-03 — includes a number extra column from DML field', () => {
    const result = generateLinkPgTable({
      tableName: 'product_inventory',
      leftFk: 'product_id',
      rightFk: 'inventory_item_id',
      extraColumns: {
        quantity: mockDmlField('number'),
      },
    })

    const cols = Object.keys(result.table as unknown as Record<string, unknown>)
    expect(cols).toContain('quantity')
  })

  // TG-04 — Link table with nullable extra column
  it('TG-04 — nullable extra column is accepted', () => {
    const result = generateLinkPgTable({
      tableName: 'order_item',
      leftFk: 'order_id',
      rightFk: 'item_id',
      extraColumns: {
        notes: mockDmlField('text', { nullable: true }),
      },
    })

    const cols = Object.keys(result.table as unknown as Record<string, unknown>)
    expect(cols).toContain('notes')
  })

  // TG-05 — Link table with default value on extra column
  it('TG-05 — extra column with default value', () => {
    const result = generateLinkPgTable({
      tableName: 'product_tag',
      leftFk: 'product_id',
      rightFk: 'tag_id',
      extraColumns: {
        position: mockDmlField('number', { defaultValue: 0 }),
      },
    })

    const cols = Object.keys(result.table as unknown as Record<string, unknown>)
    expect(cols).toContain('position')
  })

  // TG-06 — Multiple extra columns
  it('TG-06 — multiple extra columns are all included', () => {
    const result = generateLinkPgTable({
      tableName: 'product_inventory',
      leftFk: 'product_id',
      rightFk: 'inventory_item_id',
      extraColumns: {
        quantity: mockDmlField('number'),
        sku: mockDmlField('text'),
        is_default: mockDmlField('boolean'),
      },
    })

    const cols = Object.keys(result.table as unknown as Record<string, unknown>)
    expect(cols).toContain('quantity')
    expect(cols).toContain('sku')
    expect(cols).toContain('is_default')
  })

  // TG-07 — Non-DML fallback field (no .parse) gets text column
  it('TG-07 — non-DML field value falls back to text column', () => {
    const result = generateLinkPgTable({
      tableName: 'product_supplier',
      leftFk: 'product_id',
      rightFk: 'supplier_id',
      extraColumns: {
        custom_field: { someWeirdThing: true },
      },
    })

    const cols = Object.keys(result.table as unknown as Record<string, unknown>)
    expect(cols).toContain('custom_field')
  })

  // TG-08 — Extra columns do NOT override built-in columns
  it('TG-08 — extra columns do not override built-in columns (id, created_at, etc.)', () => {
    const result = generateLinkPgTable({
      tableName: 'product_tag',
      leftFk: 'product_id',
      rightFk: 'tag_id',
      extraColumns: {
        label: mockDmlField('text'),
      },
    })

    // Built-ins are still present
    const cols = Object.keys(result.table as unknown as Record<string, unknown>)
    expect(cols).toContain('id')
    expect(cols).toContain('product_id')
    expect(cols).toContain('tag_id')
    expect(cols).toContain('created_at')
    expect(cols).toContain('updated_at')
    expect(cols).toContain('deleted_at')
    // Extra column also present
    expect(cols).toContain('label')
  })

  // TG-09 — Empty extraColumns record (edge case)
  it('TG-09 — empty extraColumns record does not break generation', () => {
    const result = generateLinkPgTable({
      tableName: 'a_b',
      leftFk: 'a_id',
      rightFk: 'b_id',
      extraColumns: {},
    })

    expect(result.tableName).toBe('a_b')
    const cols = Object.keys(result.table as unknown as Record<string, unknown>)
    expect(cols).toContain('id')
    expect(cols).toContain('a_id')
    expect(cols).toContain('b_id')
  })

  // TG-10 — parse() that throws falls back to text
  it('TG-10 — parse() that throws falls back to text column', () => {
    const result = generateLinkPgTable({
      tableName: 'x_y',
      leftFk: 'x_id',
      rightFk: 'y_id',
      extraColumns: {
        broken_field: {
          parse: () => {
            throw new Error('bad field')
          },
        },
      },
    })

    const cols = Object.keys(result.table as unknown as Record<string, unknown>)
    expect(cols).toContain('broken_field')
  })
})

// ── generatePgTableFromDml — smoke test ────────────────────────

describe('generatePgTableFromDml', () => {
  // TG-11 — Basic entity table generation
  it('TG-11 — generates a table with columns from DML entity schema', () => {
    const entity = {
      name: 'Product',
      schema: {
        title: mockDmlField('text'),
        price: mockDmlField('number'),
      },
    }

    const result = generatePgTableFromDml(entity)
    expect(result.tableName).toBe('products')
    const cols = Object.keys(result.table as unknown as Record<string, unknown>)
    expect(cols).toContain('id')
    expect(cols).toContain('title')
    expect(cols).toContain('price')
    expect(cols).toContain('created_at')
    expect(cols).toContain('updated_at')
    expect(cols).toContain('deleted_at')
    expect(cols).toContain('metadata')
  })
})
