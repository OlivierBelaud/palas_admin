// Unit tests for generateDrizzleRelations()
import { describe, expect, it } from 'vitest'
import type { EntityRelationInput } from '../src/relation-generator'
import { generateIntraModuleRelations, generateLinkRelations, mergeRelationDefs } from '../src/relation-generator'

describe('generateIntraModuleRelations', () => {
  it('generates many() for hasMany relations', () => {
    const entities: EntityRelationInput[] = [
      {
        entityName: 'Product',
        tableName: 'products',
        relations: [{ name: 'variants', type: 'hasMany', target: 'Variant' }],
      },
      {
        entityName: 'Variant',
        tableName: 'variants',
        relations: [],
      },
    ]

    const defs = generateIntraModuleRelations(entities)

    expect(defs).toHaveLength(1)
    expect(defs[0]).toEqual({
      sourceEntity: 'products',
      name: 'variants',
      kind: 'many',
      target: 'variants',
    })
  })

  it('generates one() for belongsTo relations', () => {
    const entities: EntityRelationInput[] = [
      {
        entityName: 'Variant',
        tableName: 'variants',
        relations: [{ name: 'product', type: 'belongsTo', target: 'Product' }],
      },
      {
        entityName: 'Product',
        tableName: 'products',
        relations: [],
      },
    ]

    const defs = generateIntraModuleRelations(entities)

    expect(defs).toHaveLength(1)
    expect(defs[0]).toEqual({
      sourceEntity: 'variants',
      name: 'product',
      kind: 'one',
      target: 'products',
      fields: ['product_id'],
      references: ['id'],
    })
  })

  it('generates one() for hasOne relations with FK', () => {
    const entities: EntityRelationInput[] = [
      {
        entityName: 'Product',
        tableName: 'products',
        relations: [{ name: 'image', type: 'hasOneWithFK', target: 'Image' }],
      },
      {
        entityName: 'Image',
        tableName: 'images',
        relations: [],
      },
    ]

    const defs = generateIntraModuleRelations(entities)

    expect(defs).toHaveLength(1)
    expect(defs[0]).toEqual({
      sourceEntity: 'products',
      name: 'image',
      kind: 'one',
      target: 'images',
      fields: ['image_id'],
      references: ['id'],
    })
  })

  it('generates many() + pivot one() for manyToMany relations', () => {
    const entities: EntityRelationInput[] = [
      {
        entityName: 'Product',
        tableName: 'products',
        relations: [{ name: 'categories', type: 'manyToMany', target: 'Category' }],
      },
      {
        entityName: 'Category',
        tableName: 'categories',
        relations: [],
      },
    ]

    const defs = generateIntraModuleRelations(entities)

    expect(defs).toHaveLength(3)

    // Product → many(pivot)
    expect(defs[0]).toEqual({
      sourceEntity: 'products',
      name: 'categories',
      kind: 'many',
      target: 'products_categories',
    })

    // Pivot → one(products)
    expect(defs[1]).toEqual({
      sourceEntity: 'products_categories',
      name: 'products',
      kind: 'one',
      target: 'products',
      fields: ['products_id'],
      references: ['id'],
    })

    // Pivot → one(categories)
    expect(defs[2]).toEqual({
      sourceEntity: 'products_categories',
      name: 'categories',
      kind: 'one',
      target: 'categories',
      fields: ['categories_id'],
      references: ['id'],
    })
  })

  it('uses custom pivotEntity name when provided', () => {
    const entities: EntityRelationInput[] = [
      {
        entityName: 'Product',
        tableName: 'products',
        relations: [{ name: 'tags', type: 'manyToMany', target: 'Tag', pivotEntity: 'product_tags' }],
      },
      {
        entityName: 'Tag',
        tableName: 'tags',
        relations: [],
      },
    ]

    const defs = generateIntraModuleRelations(entities)

    expect(defs[0].target).toBe('product_tags')
    expect(defs[1].sourceEntity).toBe('product_tags')
    expect(defs[2].sourceEntity).toBe('product_tags')
  })
})

describe('generateLinkRelations', () => {
  it('generates pivot relations for cross-module links', () => {
    const links = [
      {
        __type: 'link' as const,
        leftModule: 'product',
        leftEntity: 'Product',
        rightModule: 'collection',
        rightEntity: 'Collection',
        tableName: 'product_product_collection_collection',
        leftFk: 'product_id',
        rightFk: 'collection_id',
        cardinality: 'M:N' as const,
        cascadeLeft: false,
        cascadeRight: false,
      },
    ] as const

    const defs = generateLinkRelations(links)

    expect(defs).toHaveLength(4)

    // Left → many(pivot)
    expect(defs[0]).toEqual({
      sourceEntity: 'product',
      name: 'link_product_product_collection_collection',
      kind: 'many',
      target: 'product_product_collection_collection',
    })

    // Right → many(pivot)
    expect(defs[1]).toEqual({
      sourceEntity: 'collection',
      name: 'link_product_product_collection_collection',
      kind: 'many',
      target: 'product_product_collection_collection',
    })

    // Pivot → one(left)
    expect(defs[2]).toEqual({
      sourceEntity: 'product_product_collection_collection',
      name: 'product',
      kind: 'one',
      target: 'product',
      fields: ['product_id'],
      references: ['id'],
    })

    // Pivot → one(right)
    expect(defs[3]).toEqual({
      sourceEntity: 'product_product_collection_collection',
      name: 'collection',
      kind: 'one',
      target: 'collection',
      fields: ['collection_id'],
      references: ['id'],
    })
  })
})

describe('mergeRelationDefs', () => {
  it('merges intra-module and link relations by source entity', () => {
    const intra = [{ sourceEntity: 'products', name: 'variants', kind: 'many' as const, target: 'variants' }]
    const links = [{ sourceEntity: 'products', name: 'link_pivot', kind: 'many' as const, target: 'pivot' }]

    const merged = mergeRelationDefs(intra, links)

    expect(merged.get('products')).toHaveLength(2)
    expect(merged.get('products')![0].name).toBe('variants')
    expect(merged.get('products')![1].name).toBe('link_pivot')
  })

  it('deduplicates by name', () => {
    const set1 = [{ sourceEntity: 'products', name: 'variants', kind: 'many' as const, target: 'variants' }]
    const set2 = [{ sourceEntity: 'products', name: 'variants', kind: 'many' as const, target: 'variants' }]

    const merged = mergeRelationDefs(set1, set2)

    expect(merged.get('products')).toHaveLength(1)
  })
})
