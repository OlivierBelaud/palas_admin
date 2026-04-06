import { type GeneratedSchema, generateDrizzleSchema, MantaError, parseDmlEntity } from '@manta/test-utils'
import { describe, expect, it } from 'vitest'

describe('DML Generator Conformance', () => {
  // DG-01 — SPEC-057f: bigNumber generates shadow column
  it('bigNumber > shadow column', () => {
    const entity = parseDmlEntity({
      name: 'Product',
      properties: [{ name: 'price', type: 'bigNumber' }],
    })

    const schema = generateDrizzleSchema(entity)

    // Must have price (NUMERIC) AND raw_price (JSONB)
    expect(schema.columns.price).toBeDefined()
    expect(schema.columns.price.type).toBe('NUMERIC')
    expect(schema.columns.raw_price).toBeDefined()
    expect(schema.columns.raw_price.type).toBe('JSONB')
  })

  // DG-02 — SPEC-057f: bigNumber shadow column conflict
  it('bigNumber > shadow conflict', () => {
    expect(() => {
      const entity = parseDmlEntity({
        name: 'Product',
        properties: [
          { name: 'price', type: 'bigNumber' },
          { name: 'raw_price', type: 'json' },
        ],
      })
      generateDrizzleSchema(entity)
    }).toThrow()
  })

  // DG-03 — SPEC-057f: enum with array literal
  it('enum > array literal', () => {
    const entity = parseDmlEntity({
      name: 'Article',
      properties: [{ name: 'status', type: 'enum', values: ['draft', 'published'] }],
    })

    const schema = generateDrizzleSchema(entity)
    const check = schema.checks.find((c) => c.name.includes('status'))
    expect(check).toBeDefined()
    expect(check!.expression).toContain('draft')
    expect(check!.expression).toContain('published')
  })

  // DG-04 — SPEC-057f: enum with TypeScript string enum
  it('enum > TypeScript enum string', () => {
    const StatusEnum = { DRAFT: 'draft', PUBLISHED: 'published' }

    const entity = parseDmlEntity({
      name: 'Article',
      properties: [{ name: 'status', type: 'enum', values: StatusEnum }],
    })

    const schema = generateDrizzleSchema(entity)
    const check = schema.checks.find((c) => c.name.includes('status'))
    expect(check).toBeDefined()
    expect(check!.expression).toContain('draft')
    expect(check!.expression).toContain('published')
  })

  // DG-05 — SPEC-057f: enum with numeric TS enum (warning + string names)
  it('enum > TypeScript enum numérique', () => {
    const Flags = { A: 0, B: 1, 0: 'A', 1: 'B' } // Simulated numeric enum

    const entity = parseDmlEntity({
      name: 'Feature',
      properties: [{ name: 'flag', type: 'enum', values: Flags }],
    })

    const schema = generateDrizzleSchema(entity)
    const check = schema.checks.find((c) => c.name.includes('flag'))
    expect(check).toBeDefined()
    // Should use names (A, B), not numeric values (0, 1)
    expect(check!.expression).toContain('A')
    expect(check!.expression).toContain('B')
  })

  // DG-06 — SPEC-057f: computed field not in schema
  it('computed > pas de colonne', () => {
    const entity = parseDmlEntity({
      name: 'User',
      properties: [
        { name: 'firstName', type: 'text' },
        { name: 'lastName', type: 'text' },
        { name: 'fullName', type: 'text', computed: true },
      ],
    })

    const schema = generateDrizzleSchema(entity)
    expect(schema.columns.firstName).toBeDefined()
    expect(schema.columns.lastName).toBeDefined()
    expect(schema.columns.fullName).toBeUndefined()
  })

  // DG-07 — SPEC-057f: implicit created_at present
  it('implicit > created_at présent', () => {
    const entity = parseDmlEntity({
      name: 'Product',
      properties: [{ name: 'name', type: 'text' }],
    })

    const schema = generateDrizzleSchema(entity)
    expect(schema.columns.created_at).toBeDefined()
    expect(schema.columns.created_at.type).toBe('TIMESTAMPTZ')
    expect(schema.columns.created_at.notNull).toBe(true)
  })

  // DG-08 — SPEC-057f: implicit column redeclaration forbidden
  it('implicit > redéclaration interdite', () => {
    expect(() => {
      const entity = parseDmlEntity({
        name: 'Product',
        properties: [
          { name: 'name', type: 'text' },
          { name: 'created_at', type: 'dateTime' },
        ],
      })
      generateDrizzleSchema(entity)
    }).toThrow()
  })

  // DG-09 — SPEC-057f: implicit updated_at present
  it('implicit > updated_at présent', () => {
    const entity = parseDmlEntity({
      name: 'Product',
      properties: [{ name: 'name', type: 'text' }],
    })

    const schema = generateDrizzleSchema(entity)
    expect(schema.columns.updated_at).toBeDefined()
    expect(schema.columns.updated_at.type).toBe('TIMESTAMPTZ')
    expect(schema.columns.updated_at.notNull).toBe(true)
  })

  // DG-10 — SPEC-057f: implicit deleted_at present (nullable)
  it('implicit > deleted_at présent', () => {
    const entity = parseDmlEntity({
      name: 'Product',
      properties: [{ name: 'name', type: 'text' }],
    })

    const schema = generateDrizzleSchema(entity)
    expect(schema.columns.deleted_at).toBeDefined()
    expect(schema.columns.deleted_at.type).toBe('TIMESTAMPTZ')
    expect(schema.columns.deleted_at.notNull).toBeFalsy()
  })

  // DG-11 — SPEC-057f: index partial with QueryCondition → SQL
  it('index partial > QueryCondition sérialisation', () => {
    const entity = parseDmlEntity({
      name: 'Product',
      properties: [{ name: 'qty', type: 'integer' }],
      indexes: [{ on: ['qty'], where: { qty: { $gt: 0 } } }],
    })

    const schema = generateDrizzleSchema(entity)
    const idx = schema.indexes.find((i) => i.columns.includes('qty'))
    expect(idx).toBeDefined()
    expect(idx!.where).toContain('qty')
    expect(idx!.where).toContain('0')
  })

  // DG-12 — SPEC-057f: index partial with $in operator
  it('index partial > $in operator', () => {
    const entity = parseDmlEntity({
      name: 'Product',
      properties: [{ name: 'status', type: 'text' }],
      indexes: [{ on: ['status'], where: { status: { $in: ['a', 'b'] } } }],
    })

    const schema = generateDrizzleSchema(entity)
    const idx = schema.indexes.find((i) => i.columns.includes('status'))
    expect(idx).toBeDefined()
    expect(idx!.where).toContain('IN')
  })

  // DG-13 — SPEC-057f: index partial with $ne null
  it('index partial > $ne null', () => {
    const entity = parseDmlEntity({
      name: 'User',
      properties: [{ name: 'email', type: 'text' }],
      indexes: [{ on: ['email'], where: { email: { $ne: null } } }],
    })

    const schema = generateDrizzleSchema(entity)
    const idx = schema.indexes.find((i) => i.columns.includes('email'))
    expect(idx).toBeDefined()
    expect(idx!.where).toContain('IS NOT NULL')
  })

  // DG-14 — SPEC-057f: manyToMany generates pivot table
  it('manyToMany > pivot table', () => {
    const entity = parseDmlEntity({
      name: 'Product',
      properties: [{ name: 'name', type: 'text' }],
      relations: [{ name: 'tags', type: 'manyToMany', target: 'Tag' }],
    })

    const schema = generateDrizzleSchema(entity)
    // Pivot table should be in relations
    const rel = schema.relations.tags
    expect(rel).toBeDefined()
    expect(rel.type).toBe('manyToMany')
    expect(rel.target).toBe('Tag')
  })

  // DG-15 — SPEC-057f: manyToMany with custom pivotEntity
  it('manyToMany > pivotEntity custom', () => {
    const entity = parseDmlEntity({
      name: 'Product',
      properties: [{ name: 'name', type: 'text' }],
      relations: [{ name: 'tags', type: 'manyToMany', target: 'Tag', pivotEntity: 'ProductTag' }],
    })

    const schema = generateDrizzleSchema(entity)
    const rel = schema.relations.tags
    expect(rel).toBeDefined()
    expect(rel.type).toBe('manyToMany')
  })

  // DG-16 — SPEC-057f: hasOneWithFK generates FK column
  it('hasOneWithFK > FK column', () => {
    const entity = parseDmlEntity({
      name: 'User',
      properties: [{ name: 'name', type: 'text' }],
      relations: [{ name: 'address', type: 'hasOne', target: 'Address', foreignKey: true }],
    })

    const schema = generateDrizzleSchema(entity)
    // FK column generated on owner table
    expect(schema.columns.address_id).toBeDefined()
  })

  // DG-17 — SPEC-057f: nullable removes NOT NULL constraint
  it('nullable > not null absent', () => {
    const entity = parseDmlEntity({
      name: 'User',
      properties: [{ name: 'bio', type: 'text', nullable: true }],
    })

    const schema = generateDrizzleSchema(entity)
    expect(schema.columns.bio).toBeDefined()
    expect(schema.columns.bio.notNull).toBeFalsy()
  })

  // DG-18 — SPEC-057f: non-nullable has NOT NULL
  it('non-nullable > not null présent', () => {
    const entity = parseDmlEntity({
      name: 'User',
      properties: [{ name: 'name', type: 'text' }],
    })

    const schema = generateDrizzleSchema(entity)
    expect(schema.columns.name).toBeDefined()
    expect(schema.columns.name.notNull).toBe(true)
  })

  // DG-19 — SPEC-057f: JSON default auto-stringified
  it('default > json auto-stringifié', () => {
    const entity = parseDmlEntity({
      name: 'Settings',
      properties: [{ name: 'config', type: 'json', default: { theme: 'dark' } }],
    })

    const schema = generateDrizzleSchema(entity)
    expect(schema.columns.config).toBeDefined()
    expect(schema.columns.config.default).toBe('{"theme":"dark"}')
  })

  // DG-20 — SPEC-057f: GIN index on JSONB
  it('index GIN > JSONB', () => {
    const entity = parseDmlEntity({
      name: 'Product',
      properties: [{ name: 'data', type: 'json' }],
      indexes: [{ on: ['data'], type: 'GIN' }],
    })

    const schema = generateDrizzleSchema(entity)
    const idx = schema.indexes.find((i) => i.columns.includes('data'))
    expect(idx).toBeDefined()
    expect(idx!.using).toBe('gin')
  })

  // DG-21 — SPEC-057f: simple index gets implicit soft-delete filter
  it('index simple > implicit soft-delete filter', () => {
    const entity = parseDmlEntity({
      name: 'User',
      properties: [{ name: 'email', type: 'text' }],
      indexes: [{ on: ['email'] }],
    })

    const schema = generateDrizzleSchema(entity)
    const idx = schema.indexes.find((i) => i.columns.includes('email'))
    expect(idx).toBeDefined()
    expect(idx!.where).toContain('deleted_at IS NULL')
  })

  // DG-22 — SPEC-057f: composite index gets implicit soft-delete filter
  // FIX: removed explicit created_at property — it's an implicit column (SPEC-057f)
  // and cannot be redeclared. The index can still reference implicit columns.
  it('index composite > implicit soft-delete filter', () => {
    const entity = parseDmlEntity({
      name: 'Order',
      properties: [{ name: 'status', type: 'text' }],
      indexes: [{ on: ['status', 'created_at'] }],
    })

    const schema = generateDrizzleSchema(entity)
    const idx = schema.indexes.find((i) => i.columns.includes('status') && i.columns.includes('created_at'))
    expect(idx).toBeDefined()
    expect(idx!.where).toContain('deleted_at IS NULL')
  })

  // DG-23 — SPEC-057f: explicit where overrides implicit soft-delete
  it('index avec where explicite > PAS de soft-delete implicite', () => {
    const entity = parseDmlEntity({
      name: 'User',
      properties: [{ name: 'email', type: 'text' }],
      indexes: [{ on: ['email'], where: 'email IS NOT NULL' }],
    })

    const schema = generateDrizzleSchema(entity)
    const idx = schema.indexes.find((i) => i.columns.includes('email'))
    expect(idx).toBeDefined()
    expect(idx!.where).toBe('email IS NOT NULL')
    // Should NOT contain deleted_at IS NULL
    expect(idx!.where).not.toContain('deleted_at')
  })
})
