import {
  BaseProperty,
  ComputedProperty,
  DmlEntity,
  field,
  model,
  NullableModifier,
  PrimaryKeyModifier,
  TextProperty,
} from '@manta/core'
import { describe, expect, it } from 'vitest'

describe('DML Fluent API', () => {
  // DF-01 — field.text() returns TextProperty
  it('field.text() returns TextProperty', () => {
    const prop = field.text()
    expect(prop).toBeInstanceOf(TextProperty)
    expect(prop).toBeInstanceOf(BaseProperty)
    expect(prop.parse('test').dataType.name).toBe('text')
  })

  // DF-02 — .nullable() returns NullableModifier (changes inferred type to T | null)
  it('.nullable() returns NullableModifier', () => {
    const prop = field.text().nullable()
    expect(NullableModifier.isNullableModifier(prop)).toBe(true)
    const meta = prop.parse('field')
    expect(meta.nullable).toBe(true)
  })

  // DF-03 — .default() chains and sets default
  it('.default() chainable', () => {
    const prop = field.text().default('untitled')
    const meta = prop.parse('field')
    expect(meta.defaultValue).toBe('untitled')
  })

  // DF-04 — .unique() chains and sets unique
  it('.unique() chainable', () => {
    const prop = field.text().unique()
    expect(prop.parse('field').unique).toBe(true)
  })

  // DF-05 — .unique() with custom name
  it('.unique(name) sets constraint name', () => {
    const prop = field.text().unique('uq_email')
    expect(prop.parse('field').unique).toBe('uq_email')
  })

  // DF-06 — .index() chains and sets index
  it('.index() chainable', () => {
    const prop = field.text().index()
    expect(prop.parse('field').indexes.length).toBeGreaterThan(0)
  })

  // DF-07 — .index() with custom name
  it('.index(name) sets index name', () => {
    const prop = field.text().index('idx_title')
    expect(prop.parse('field').indexes[0].name).toBe('idx_title')
  })

  // DF-08 — .computed() returns ComputedProperty
  it('.computed() returns ComputedProperty', () => {
    const prop = field.text().computed()
    expect(ComputedProperty.isComputedProperty(prop)).toBe(true)
    expect(prop.parse('field').computed).toBe(true)
  })

  // DF-09 — .searchable() chains (TextProperty only)
  it('.searchable() chainable on TextProperty', () => {
    const prop = field.text().searchable()
    expect(prop).toBeInstanceOf(TextProperty)
    expect(prop.parse('field').searchable).toBe(true)
  })

  // DF-10 — .translatable() chains (TextProperty only)
  it('.translatable() chainable on TextProperty', () => {
    const prop = field.text().translatable()
    expect(prop.parse('field').translatable).toBe(true)
  })

  // DF-11 — Multiple modifiers chain together
  it('multiple modifiers chain', () => {
    const prop = field.text().default('draft').index().searchable()
    const meta = prop.parse('field')
    expect(meta.defaultValue).toBe('draft')
    expect(meta.indexes.length).toBeGreaterThan(0)
    expect(meta.searchable).toBe(true)
  })

  // DF-12 — All property types return typed instances
  it('all types return BaseProperty subclasses', () => {
    expect(field.text()).toBeInstanceOf(BaseProperty)
    expect(field.number()).toBeInstanceOf(BaseProperty)
    expect(field.boolean()).toBeInstanceOf(BaseProperty)
    expect(field.bigNumber()).toBeInstanceOf(BaseProperty)
    expect(field.float()).toBeInstanceOf(BaseProperty)
    expect(field.serial()).toBeInstanceOf(BaseProperty)
    expect(field.dateTime()).toBeInstanceOf(BaseProperty)
    expect(field.json()).toBeInstanceOf(BaseProperty)
    expect(field.enum(['a', 'b'] as const)).toBeInstanceOf(BaseProperty)
    expect(field.array()).toBeInstanceOf(BaseProperty)
  })

  // DF-15 — field.text().primaryKey() returns PrimaryKeyModifier<string>
  it('field.text().primaryKey() returns PrimaryKeyModifier', () => {
    const prop = field.text().primaryKey()
    expect(PrimaryKeyModifier.isPrimaryKeyModifier(prop)).toBe(true)
    expect(prop.parse('code').primaryKey).toBe(true)
  })

  // DF-16 — field.enum() stores values
  it('field.enum() stores values and infers type', () => {
    const prop = field.enum(['draft', 'published'] as const)
    const meta = prop.parse('status')
    expect(meta.dataType.name).toBe('enum')
    expect(meta.values).toEqual(['draft', 'published'])
  })

  // DF-17 — Properties work in model.define()
  it('properties work in model.define()', () => {
    const Product = model.define('Product', {
      title: field.text().nullable(),
      price: field.bigNumber(),
      status: field.enum(['draft', 'published'] as const),
    })

    expect(Product).toBeInstanceOf(DmlEntity)
    expect(Product.name).toBe('Product')
  })

  // DF-18 — Nullable + default chain
  it('nullable().default() not available (nullable returns wrapper)', () => {
    // After .nullable(), you get a NullableModifier, not a TextProperty
    // So .default() is not available — this is by design (matches Medusa)
    const prop = field.text().default('hello').nullable()
    expect(NullableModifier.isNullableModifier(prop)).toBe(true)
    const meta = prop.parse('field')
    expect(meta.nullable).toBe(true)
    expect(meta.defaultValue).toBe('hello')
  })
})
