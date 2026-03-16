import { describe, it, expect, beforeEach } from 'vitest'
import { defineLink, getRegisteredLinks, clearLinkRegistry, REMOTE_LINK } from '@manta/core'

describe('defineLink', () => {
  beforeEach(() => {
    clearLinkRegistry()
  })

  // LK-01 — Creates a link definition
  it('creates a link with computed table name', () => {
    const link = defineLink({
      leftModule: 'product',
      leftEntity: 'Product',
      rightModule: 'collection',
      rightEntity: 'Collection',
    })

    expect(link.tableName).toBe('product_product_collection_collection')
    expect(link.leftFk).toBe('product_id')
    expect(link.rightFk).toBe('collection_id')
  })

  // LK-02 — Custom table name
  it('supports custom table name', () => {
    const link = defineLink({
      leftModule: 'product',
      leftEntity: 'Product',
      rightModule: 'collection',
      rightEntity: 'Collection',
      database: { table: 'product_collections' },
    })

    expect(link.tableName).toBe('product_collections')
  })

  // LK-03 — Auto-registers in global registry
  it('auto-registers in global registry', () => {
    defineLink({
      leftModule: 'product',
      leftEntity: 'Product',
      rightModule: 'tag',
      rightEntity: 'Tag',
    })

    defineLink({
      leftModule: 'order',
      leftEntity: 'Order',
      rightModule: 'customer',
      rightEntity: 'Customer',
    })

    const links = getRegisteredLinks()
    expect(links).toHaveLength(2)
    expect(links[0].leftModule).toBe('product')
    expect(links[1].leftModule).toBe('order')
  })

  // LK-04 — clearLinkRegistry() empties registry
  it('clearLinkRegistry empties registry', () => {
    defineLink({
      leftModule: 'a',
      leftEntity: 'A',
      rightModule: 'b',
      rightEntity: 'B',
    })

    clearLinkRegistry()
    expect(getRegisteredLinks()).toHaveLength(0)
  })

  // LK-05 — Delete cascade config
  it('preserves deleteCascade config', () => {
    const link = defineLink({
      leftModule: 'order',
      leftEntity: 'Order',
      rightModule: 'item',
      rightEntity: 'Item',
      deleteCascade: { left: true, right: false },
    })

    expect(link.deleteCascade).toEqual({ left: true, right: false })
  })

  // LK-06 — Read-only link
  it('supports read-only links', () => {
    const link = defineLink({
      leftModule: 'product',
      leftEntity: 'Product',
      rightModule: 'supplier',
      rightEntity: 'Supplier',
      isReadOnlyLink: true,
    })

    expect(link.isReadOnlyLink).toBe(true)
  })

  // LK-07 — REMOTE_LINK is a Symbol
  it('REMOTE_LINK is a Symbol', () => {
    expect(typeof REMOTE_LINK).toBe('symbol')
    expect(REMOTE_LINK.toString()).toContain('manta:remote_link')
  })

  // LK-08 — Extra columns config
  it('supports extra columns config', () => {
    const link = defineLink({
      leftModule: 'product',
      leftEntity: 'Product',
      rightModule: 'tag',
      rightEntity: 'Tag',
      database: { extraColumns: { position: { type: 'INTEGER', default: 0 } } },
    })

    expect(link.database?.extraColumns).toBeDefined()
    expect(link.database!.extraColumns!.position).toBeDefined()
  })
})
