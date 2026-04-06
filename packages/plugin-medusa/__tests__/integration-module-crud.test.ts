// Integration test: Load a real Medusa module and verify CRUD operations work
// through the Manta service factory bridge.

import { InMemoryRepository } from '@manta/core'
import { describe, expect, it } from 'vitest'
import { discoverModules } from '../src/_internal/discovery/modules'
import { MedusaServiceBridge } from '../src/_internal/mapping/service-factory'

describe('integration: module CRUD via bridge', () => {
  it('MedusaServiceBridge creates a service class from DML models', () => {
    // Simulate what Medusa does: MedusaService({ Product: ProductModel })
    const fakeModel = { name: 'TestEntity' }
    const ServiceClass = MedusaServiceBridge({ TestEntity: fakeModel })
    expect(ServiceClass).toBeDefined()
    expect(typeof ServiceClass).toBe('function')
  })

  it('bridged service instantiates with Medusa-style deps', () => {
    const fakeModel = { name: 'TestEntity' }
    const ServiceClass = MedusaServiceBridge({ TestEntity: fakeModel })
    const repo = new InMemoryRepository()

    // Medusa-style constructor: { baseRepository, productService, ... }
    const service = new ServiceClass({ baseRepository: repo })
    expect(service).toBeDefined()
  })

  it('bridged service has CRUD methods for each model', () => {
    const fakeModel = { name: 'Product' }
    const ServiceClass = MedusaServiceBridge({ Product: fakeModel })
    const service = new ServiceClass({ baseRepository: new InMemoryRepository() })

    // createService generates methods based on model name
    expect(typeof service.retrieveProduct).toBe('function')
    expect(typeof service.listProducts).toBe('function')
    expect(typeof service.listAndCountProducts).toBe('function')
    expect(typeof service.createProducts).toBe('function')
    expect(typeof service.updateProducts).toBe('function')
    expect(typeof service.deleteProducts).toBe('function')
    expect(typeof service.softDeleteProducts).toBe('function')
    expect(typeof service.restoreProducts).toBe('function')
  })

  it('CRUD lifecycle: create → list → retrieve → delete', async () => {
    const fakeModel = { name: 'Item' }
    const ServiceClass = MedusaServiceBridge({ Item: fakeModel })
    const repo = new InMemoryRepository()
    const service = new ServiceClass({ baseRepository: repo })

    // Create
    const created = await service.createItems([{ title: 'Widget A' }, { title: 'Widget B' }])
    expect(created).toHaveLength(2)
    expect(created[0].id).toBeDefined()
    expect(created[0].title).toBe('Widget A')

    // List
    const items = await service.listItems()
    expect(items).toHaveLength(2)

    // Retrieve
    const item = await service.retrieveItem(created[0].id)
    expect(item.title).toBe('Widget A')

    // Delete
    await service.deleteItems([created[0].id])
    const remaining = await service.listItems()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].title).toBe('Widget B')
  })

  it('loads real Medusa Product module DML models into the bridge', () => {
    // Discover the actual Product module from @medusajs/medusa
    const modules = discoverModules()
    const productModule = modules.find((m) => m.name === 'product')
    expect(productModule).toBeDefined()

    // Build models map from discovered DML entities
    const models: Record<string, { name: string }> = {}
    for (const model of productModule!.models) {
      models[model.name] = { name: model.name }
    }

    // Create a bridged service with real Medusa DML models
    const ServiceClass = MedusaServiceBridge(models)
    const service = new ServiceClass({ baseRepository: new InMemoryRepository() })

    // Verify CRUD methods exist for Product, ProductVariant, etc.
    expect(typeof service.retrieveProduct).toBe('function')
    expect(typeof service.listProducts).toBe('function')
    expect(typeof service.createProducts).toBe('function')
    expect(typeof service.retrieveProductVariant).toBe('function')
    expect(typeof service.listProductVariants).toBe('function')
    expect(typeof service.retrieveProductCategory).toBe('function')
    expect(typeof service.listProductCategories).toBe('function')
    expect(typeof service.retrieveProductTag).toBe('function')
    expect(typeof service.listProductTags).toBe('function')
  })

  it('CRUD with real Medusa Product models', async () => {
    const modules = discoverModules()
    const productModule = modules.find((m) => m.name === 'product')!
    const models: Record<string, { name: string }> = {}
    for (const model of productModule.models) {
      models[model.name] = { name: model.name }
    }

    const ServiceClass = MedusaServiceBridge(models)
    const service = new ServiceClass({ baseRepository: new InMemoryRepository() })
    // Create a product
    const [product] = await service.createProducts([{ title: 'Test Shirt', handle: 'test-shirt', status: 'draft' }])
    expect(product.id).toBeDefined()
    expect(product.title).toBe('Test Shirt')

    // List products
    const products = await service.listProducts()
    expect(products).toHaveLength(1)

    // Retrieve
    const retrieved = await service.retrieveProduct(product.id)
    expect(retrieved.title).toBe('Test Shirt')

    // Update
    const [updated] = await service.updateProducts([{ id: product.id, title: 'Updated Shirt' }])
    expect(updated.title).toBe('Updated Shirt')

    // Delete
    await service.deleteProducts([product.id])
    const empty = await service.listProducts()
    expect(empty).toHaveLength(0)
  })
})
