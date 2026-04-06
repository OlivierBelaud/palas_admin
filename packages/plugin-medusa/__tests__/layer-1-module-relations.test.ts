// Layer 1b: Module relation discovery tests
// Verifies that intra-module DML relations (hasMany, belongsTo, manyToMany, etc.)
// are correctly extracted from Medusa modules.

import { beforeAll, describe, expect, it } from 'vitest'
import { clearAlerts } from '../src/_internal/alerts'
import type { DiscoveredModule, DiscoveredRelation } from '../src/_internal/discovery/modules'
import { buildEntityRelationInputs, discoverModules } from '../src/_internal/discovery/modules'

describe('layer-1b: module intra-module relations', () => {
  let modules: DiscoveredModule[]

  beforeAll(() => {
    clearAlerts()
    modules = discoverModules()
  })

  it('discovers modules with DML models', () => {
    const withModels = modules.filter((m) => m.models.length > 0)
    expect(withModels.length).toBeGreaterThanOrEqual(10)
  })

  it('extracts relations from DML models', () => {
    const allRelations: DiscoveredRelation[] = []
    for (const mod of modules) {
      for (const model of mod.models) {
        allRelations.push(...model.relations)
      }
    }
    // 195 relations found in exploration — allow some variation
    expect(allRelations.length).toBeGreaterThanOrEqual(150)
  })

  // ── Product module ──────────────────────────────────────────────

  describe('product module', () => {
    let productModule: DiscoveredModule

    beforeAll(() => {
      productModule = modules.find((m) => m.name === 'product')!
    })

    it('has Product model with relations', () => {
      const product = productModule.models.find((m) => m.name === 'Product')!
      expect(product).toBeTruthy()
      expect(product.relations.length).toBeGreaterThanOrEqual(5)
    })

    it('Product hasMany ProductVariant', () => {
      const product = productModule.models.find((m) => m.name === 'Product')!
      const variants = product.relations.find((r) => r.name === 'variants')
      expect(variants).toBeTruthy()
      expect(variants!.type).toBe('hasMany')
      expect(variants!.target).toBe('ProductVariant')
      expect(variants!.mappedBy).toBe('product')
    })

    it('ProductVariant belongsTo Product', () => {
      const variant = productModule.models.find((m) => m.name === 'ProductVariant')!
      const product = variant.relations.find((r) => r.name === 'product')
      expect(product).toBeTruthy()
      expect(product!.type).toBe('belongsTo')
      expect(product!.target).toBe('Product')
      expect(product!.mappedBy).toBe('variants')
    })

    it('Product manyToMany ProductTag with pivotTable', () => {
      const product = productModule.models.find((m) => m.name === 'Product')!
      const tags = product.relations.find((r) => r.name === 'tags')
      expect(tags).toBeTruthy()
      expect(tags!.type).toBe('manyToMany')
      expect(tags!.target).toBe('ProductTag')
      expect(tags!.pivotTable).toBe('product_tags')
    })

    it('ProductVariant manyToMany ProductImage with pivotEntity', () => {
      const variant = productModule.models.find((m) => m.name === 'ProductVariant')!
      const images = variant.relations.find((r) => r.name === 'images')
      expect(images).toBeTruthy()
      expect(images!.type).toBe('manyToMany')
      expect(images!.target).toBe('ProductImage')
      expect(images!.pivotEntity).toBe('ProductVariantProductImage')
    })

    it('Product belongsTo ProductCollection (nullable)', () => {
      const product = productModule.models.find((m) => m.name === 'Product')!
      const collection = product.relations.find((r) => r.name === 'collection')
      expect(collection).toBeTruthy()
      expect(collection!.type).toBe('belongsTo')
      expect(collection!.target).toBe('ProductCollection')
      expect(collection!.nullable).toBe(true)
    })
  })

  // ── Order module ────────────────────────────────────────────────

  describe('order module', () => {
    it('has many relations (largest module)', () => {
      const orderModule = modules.find((m) => m.name === 'order')!
      const totalRels = orderModule.models.reduce((sum, m) => sum + m.relations.length, 0)
      // Order module has ~60 relations
      expect(totalRels).toBeGreaterThanOrEqual(40)
    })
  })

  // ── Customer module ─────────────────────────────────────────────

  describe('customer module', () => {
    it('Customer manyToMany CustomerGroup with pivotEntity', () => {
      const customerModule = modules.find((m) => m.name === 'customer')!
      const customer = customerModule.models.find((m) => m.name === 'Customer')!
      const groups = customer.relations.find((r) => r.name === 'groups')
      expect(groups).toBeTruthy()
      expect(groups!.type).toBe('manyToMany')
      expect(groups!.target).toBe('CustomerGroup')
      expect(groups!.pivotEntity).toBe('CustomerGroupCustomer')
    })
  })

  // ── Relation types coverage ─────────────────────────────────────

  it('covers all relation types: hasMany, belongsTo, manyToMany', () => {
    const allRelations: DiscoveredRelation[] = []
    for (const mod of modules) {
      for (const model of mod.models) {
        allRelations.push(...model.relations)
      }
    }

    const types = new Set(allRelations.map((r) => r.type))
    expect(types.has('hasMany')).toBe(true)
    expect(types.has('belongsTo')).toBe(true)
    expect(types.has('manyToMany')).toBe(true)
  })

  // ── buildEntityRelationInputs ───────────────────────────────────

  describe('buildEntityRelationInputs', () => {
    it('produces EntityRelationInput[] from discovered modules', () => {
      const inputs = buildEntityRelationInputs(modules)

      // Should have entries for entities with relations
      expect(inputs.length).toBeGreaterThanOrEqual(30)

      // Each input has entityName, tableName, relations
      for (const input of inputs) {
        expect(input.entityName).toBeTruthy()
        expect(input.tableName).toBeTruthy()
        expect(input.relations.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('converts entity names to snake_case table names', () => {
      const inputs = buildEntityRelationInputs(modules)

      const productVariant = inputs.find((i) => i.entityName === 'ProductVariant')
      expect(productVariant).toBeTruthy()
      expect(productVariant!.tableName).toBe('product_variants')

      const product = inputs.find((i) => i.entityName === 'Product')
      expect(product).toBeTruthy()
      expect(product!.tableName).toBe('products')
    })

    it('preserves pivotEntity for manyToMany relations', () => {
      const inputs = buildEntityRelationInputs(modules)

      const variant = inputs.find((i) => i.entityName === 'ProductVariant')!
      const images = variant.relations.find((r) => r.name === 'images')
      expect(images).toBeTruthy()
      expect(images!.pivotEntity).toBe('ProductVariantProductImage')
    })

    it('output is compatible with generateIntraModuleRelations()', () => {
      const inputs = buildEntityRelationInputs(modules)

      // Each input must have the shape: { entityName, tableName, relations: [{name, type, target}] }
      for (const input of inputs) {
        expect(typeof input.entityName).toBe('string')
        expect(typeof input.tableName).toBe('string')
        for (const rel of input.relations) {
          expect(typeof rel.name).toBe('string')
          expect(typeof rel.type).toBe('string')
          expect(typeof rel.target).toBe('string')
        }
      }
    })
  })
})
