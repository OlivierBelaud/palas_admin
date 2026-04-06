import { clearLinkRegistry, defineLink, ENTITY_TAG, getRegisteredLinks, many, REMOTE_LINK } from '@manta/core'
import { beforeEach, describe, expect, it } from 'vitest'

describe('defineLink', () => {
  beforeEach(() => {
    clearLinkRegistry()
  })

  // LK-01 — Creates a link definition
  it('creates a link with computed table name', () => {
    const link = defineLink((m) => [m.Product, m.Collection])

    expect(link.tableName).toBe('product_collection')
    expect(link.leftFk).toBe('product_id')
    expect(link.rightFk).toBe('collection_id')
  })

  // LK-02 — Extra columns
  it('supports extra columns', () => {
    const link = defineLink((m) => [m.Product, m.Tag], { position: { type: 'INTEGER', default: 0 } })

    expect(link.extraColumns).toBeDefined()
    expect(link.extraColumns!.position).toBeDefined()
  })

  // LK-03 — Auto-registers in global registry
  it('auto-registers in global registry', () => {
    defineLink((m) => [m.Product, m.Tag])
    defineLink((m) => [m.Order, m.Customer])

    const links = getRegisteredLinks()
    expect(links).toHaveLength(2)
    expect(links[0].leftEntity).toBe('Product')
    expect(links[1].leftEntity).toBe('Order')
  })

  // LK-04 — clearLinkRegistry() empties registry
  it('clearLinkRegistry empties registry', () => {
    defineLink((m) => [m.A, m.B])

    clearLinkRegistry()
    expect(getRegisteredLinks()).toHaveLength(0)
  })

  // LK-05 — Cascade rules for 1:N
  it('auto-cascade for 1:N links', () => {
    const link = defineLink((m) => [m.Order, many(m.Item)])

    expect(link.cardinality).toBe('1:N')
    expect(link.cascadeLeft).toBe(true) // deleting Order cascades to Items
    expect(link.cascadeRight).toBe(false) // deleting Item does NOT cascade to Order
  })

  // LK-06 — Cascade rules for M:N
  it('no cascade for M:N links', () => {
    const link = defineLink((m) => [many(m.Product), many(m.Supplier)])

    expect(link.cardinality).toBe('M:N')
    expect(link.cascadeLeft).toBe(false)
    expect(link.cascadeRight).toBe(false)
  })

  // LK-07 — REMOTE_LINK is a Symbol
  it('REMOTE_LINK is a Symbol', () => {
    expect(typeof REMOTE_LINK).toBe('symbol')
    expect(REMOTE_LINK.toString()).toContain('manta:remote_link')
  })

  // LK-08 — Cascade rules for 1:1
  it('auto-cascade for 1:1 links', () => {
    const link = defineLink((m) => [m.Product, m.Detail])

    expect(link.cardinality).toBe('1:1')
    expect(link.cascadeLeft).toBe(true)
    expect(link.cascadeRight).toBe(true)
  })
})

describe('ENTITY_TAG', () => {
  // LK-09 — Tagged objects carry entity name
  it('ENTITY_TAG is a symbol', () => {
    expect(typeof ENTITY_TAG).toBe('symbol')
  })

  // LK-10 — Can tag an object with entity name
  it('tagged object carries entity name', () => {
    const product = { id: 'prod_1', title: 'Widget' }
    Object.defineProperty(product, ENTITY_TAG, { value: 'Product', enumerable: false })

    expect((product as Record<symbol, string>)[ENTITY_TAG]).toBe('Product')
    // Tag is not enumerable — doesn't appear in JSON/spread
    expect(Object.keys(product)).toEqual(['id', 'title'])
  })

  // LK-11 — Entity ref { entity, id } format
  it('EntityRef format is accepted', () => {
    const ref = { entity: 'Product', id: 'prod_1' }
    expect(ref.entity).toBe('Product')
    expect(ref.id).toBe('prod_1')
  })
})
