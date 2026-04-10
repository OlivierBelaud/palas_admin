// Bootstrap helpers tests — verifies extracted helper functions.

import { describe, expect, it } from 'vitest'
import { DML_TO_SQL, entityToTableKey, hasModelObjects, isDmlEntity } from '../../src/bootstrap/bootstrap-helpers'

describe('entityToTableKey()', () => {
  // BH-01 — Simple entity name pluralization
  it('BH-01: pluralizes simple entity names', () => {
    expect(entityToTableKey('Product')).toBe('products')
    expect(entityToTableKey('Order')).toBe('orders')
  })

  // BH-02 — Entity names ending in s/x/ch/sh
  it('BH-02: pluralizes names ending in s/x/ch/sh with -es', () => {
    expect(entityToTableKey('Address')).toBe('addresses')
    expect(entityToTableKey('Tax')).toBe('taxes')
    expect(entityToTableKey('Match')).toBe('matches')
    expect(entityToTableKey('Wish')).toBe('wishes')
  })

  // BH-03 — Entity names ending in consonant + y
  it('BH-03: pluralizes consonant+y names with -ies', () => {
    expect(entityToTableKey('Category')).toBe('categories')
    expect(entityToTableKey('Currency')).toBe('currencies')
  })

  // BH-04 — Entity names ending in vowel + y
  it('BH-04: pluralizes vowel+y names with -s', () => {
    expect(entityToTableKey('Survey')).toBe('surveys')
    expect(entityToTableKey('Key')).toBe('keys')
  })

  // BH-05 — PascalCase entity names lowercase first char
  it('BH-05: lowercases first character of PascalCase names', () => {
    expect(entityToTableKey('InventoryItem')).toBe('inventoryItems')
    expect(entityToTableKey('CustomerGroup')).toBe('customerGroups')
  })
})

describe('isDmlEntity()', () => {
  // BH-06 — Recognizes DML entity objects
  it('BH-06: returns true for objects with name + schema', () => {
    expect(isDmlEntity({ name: 'Product', schema: {} })).toBe(true)
  })

  // BH-07 — Rejects non-entity values
  it('BH-07: returns false for non-entity values', () => {
    expect(isDmlEntity(null)).toBe(false)
    expect(isDmlEntity(undefined)).toBe(false)
    expect(isDmlEntity('string')).toBe(false)
    expect(isDmlEntity(42)).toBe(false)
    expect(isDmlEntity({ name: 123, schema: {} })).toBe(false)
    expect(isDmlEntity({ schema: {} })).toBe(false)
    expect(isDmlEntity({ name: 'X' })).toBe(false)
  })
})

describe('hasModelObjects()', () => {
  // BH-08 — Recognizes classes with $modelObjects
  it('BH-08: returns true for functions with $modelObjects', () => {
    function TestClass() {}
    ;(TestClass as any).$modelObjects = { Product: {} }
    expect(hasModelObjects(TestClass)).toBe(true)
  })

  // BH-09 — Rejects non-class values
  it('BH-09: returns false for non-function values', () => {
    expect(hasModelObjects({})).toBe(false)
    expect(hasModelObjects(null)).toBe(false)
    expect(hasModelObjects('string')).toBe(false)
  })

  // BH-10 — Rejects functions without $modelObjects
  it('BH-10: returns false for functions without $modelObjects', () => {
    function PlainClass() {}
    expect(hasModelObjects(PlainClass)).toBe(false)
  })
})

describe('DML_TO_SQL mapping', () => {
  // BH-11 — All expected DML types are mapped
  it('BH-11: maps all DML types to SQL types', () => {
    expect(DML_TO_SQL.id).toBe('TEXT PRIMARY KEY')
    expect(DML_TO_SQL.text).toBe('TEXT')
    expect(DML_TO_SQL.number).toBe('INTEGER')
    expect(DML_TO_SQL.boolean).toBe('BOOLEAN')
    expect(DML_TO_SQL.float).toBe('REAL')
    expect(DML_TO_SQL.bigNumber).toBe('NUMERIC')
    expect(DML_TO_SQL.serial).toBe('SERIAL')
    expect(DML_TO_SQL.dateTime).toBe('TIMESTAMPTZ')
    expect(DML_TO_SQL.json).toBe('JSONB')
    expect(DML_TO_SQL.enum).toBe('TEXT')
    expect(DML_TO_SQL.array).toBe('JSONB')
  })
})
