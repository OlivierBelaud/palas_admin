import { describe, it, expect } from 'vitest'
import { model, DmlProperty, DmlEntity } from '@manta/core'

describe('DML Fluent API', () => {
  // DF-01 — model.text() returns DmlProperty instance
  it('model.text() returns DmlProperty', () => {
    const prop = model.text()
    expect(prop).toBeInstanceOf(DmlProperty)
    expect(prop.__dml).toBe(true)
    expect(prop.type).toBe('text')
  })

  // DF-02 — .setNullable() chains and sets nullable
  it('.setNullable() chainable', () => {
    const prop = model.text().setNullable()
    expect(prop.nullable).toBe(true)
    expect(prop).toBeInstanceOf(DmlProperty)
  })

  // DF-03 — .setDefault() chains and sets default
  it('.setDefault() chainable', () => {
    const prop = model.text().setDefault('untitled')
    expect(prop.default).toBe('untitled')
  })

  // DF-04 — .setUnique() chains and sets unique
  it('.setUnique() chainable', () => {
    const prop = model.text().setUnique()
    expect(prop.unique).toBe(true)
  })

  // DF-05 — .setUnique() with custom name
  it('.setUnique(name) sets constraint name', () => {
    const prop = model.text().setUnique('uq_email')
    expect(prop.unique).toBe('uq_email')
  })

  // DF-06 — .indexed() chains and sets index
  it('.indexed() chainable', () => {
    const prop = model.text().indexed()
    expect(prop.index).toBe(true)
  })

  // DF-07 — .indexed() with custom name
  it('.indexed(name) sets index name', () => {
    const prop = model.text().indexed('idx_title')
    expect(prop.index).toBe('idx_title')
  })

  // DF-08 — .setComputed() chains
  it('.setComputed() chainable', () => {
    const prop = model.text().setComputed()
    expect(prop.computed).toBe(true)
  })

  // DF-09 — .setSearchable() chains
  it('.setSearchable() chainable', () => {
    const prop = model.text().setSearchable()
    expect(prop.searchable).toBe(true)
  })

  // DF-10 — .setTranslatable() chains
  it('.setTranslatable() chainable', () => {
    const prop = model.text().setTranslatable()
    expect(prop.translatable).toBe(true)
  })

  // DF-11 — Multiple modifiers chain together
  it('multiple modifiers chain', () => {
    const prop = model.text()
      .setNullable()
      .setDefault('draft')
      .indexed()
      .setSearchable()

    expect(prop.nullable).toBe(true)
    expect(prop.default).toBe('draft')
    expect(prop.index).toBe(true)
    expect(prop.searchable).toBe(true)
  })

  // DF-12 — All property types return DmlProperty
  it('all types return DmlProperty', () => {
    expect(model.text()).toBeInstanceOf(DmlProperty)
    expect(model.number()).toBeInstanceOf(DmlProperty)
    expect(model.boolean()).toBeInstanceOf(DmlProperty)
    expect(model.bigNumber()).toBeInstanceOf(DmlProperty)
    expect(model.float()).toBeInstanceOf(DmlProperty)
    expect(model.serial()).toBeInstanceOf(DmlProperty)
    expect(model.dateTime()).toBeInstanceOf(DmlProperty)
    expect(model.json()).toBeInstanceOf(DmlProperty)
    expect(model.enum(['a', 'b'])).toBeInstanceOf(DmlProperty)
    expect(model.array()).toBeInstanceOf(DmlProperty)
    expect(model.id()).toBeInstanceOf(DmlProperty)
  })

  // DF-13 — DmlProperty passes isProperty() type guard
  it('passes DmlEntity.isProperty() type guard', () => {
    const prop = model.text().setNullable()
    expect(DmlEntity.isProperty(prop)).toBe(true)
  })

  // DF-14 — model.id() sets primaryKey
  it('model.id() sets primaryKey', () => {
    const prop = model.id()
    expect(prop.primaryKey).toBe(true)
  })

  // DF-15 — model.id({ prefix }) sets default prefix
  it('model.id({ prefix }) stores prefix', () => {
    const prop = model.id({ prefix: 'prod' })
    expect(prop.primaryKey).toBe(true)
    expect(prop.default).toBe('prod')
  })

  // DF-16 — model.enum() stores values
  it('model.enum() stores values', () => {
    const prop = model.enum(['draft', 'published'])
    expect(prop.type).toBe('enum')
    expect(prop.values).toEqual(['draft', 'published'])
  })

  // DF-17 — DmlProperty works in model.define()
  it('DmlProperty works in model.define()', () => {
    const Product = model.define('Product', {
      title: model.text().setNullable(),
      price: model.bigNumber(),
      status: model.enum(['draft', 'published']),
    })

    expect(Product).toBeInstanceOf(DmlEntity)
    expect(Product.name).toBe('Product')

    const titleProp = Product.schema.title
    expect(DmlEntity.isProperty(titleProp)).toBe(true)
    expect((titleProp as DmlProperty).nullable).toBe(true)
  })
})
