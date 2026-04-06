import { describe, expect, it } from 'vitest'
import { defineModule, Module } from '../../src/module'

describe('Module System', () => {
  class ProductModuleService {}
  class OrderModuleService {}

  // MOD-01 — Module() wraps a service class (Medusa V2 signature)
  it('Module(name, { service }) wraps a service class into ModuleExports', () => {
    const mod = Module('product', { service: ProductModuleService })
    expect(mod.service).toBe(ProductModuleService)
    expect(mod.name).toBe('product')
  })

  // MOD-02 — Module() uses given name
  it('uses the provided service name', () => {
    expect(Module('product', { service: ProductModuleService }).name).toBe('product')
    expect(Module('order', { service: OrderModuleService }).name).toBe('order')
  })

  // MOD-03 — Module() accepts lifecycle hooks
  it('accepts lifecycle hooks', () => {
    let started = false
    const mod = Module('product', {
      service: ProductModuleService,
      hooks: {
        onApplicationStart: () => {
          started = true
        },
      },
    })

    expect(mod.hooks).toBeDefined()
    mod.hooks!.onApplicationStart!()
    expect(started).toBe(true)
  })

  // MOD-04 — Module() accepts loaders
  it('accepts loaders', () => {
    const loader = async () => {}
    const mod = Module('product', { service: ProductModuleService, loaders: [loader] })
    expect(mod.loaders).toHaveLength(1)
    expect(mod.loaders![0]).toBe(loader)
  })

  // MOD-05 — Module() accepts version
  it('accepts version', () => {
    const mod = Module('product', { service: ProductModuleService, version: '1.0.0' })
    expect(mod.version).toBe('1.0.0')
  })

  // MOD-06 — Module() generates linkableKeys from models
  it('generates linkableKeys from models', () => {
    const mod = Module('product', {
      service: ProductModuleService,
      models: {
        Product: { name: 'Product' },
        Variant: { name: 'Variant' },
      },
    })

    expect(mod.linkableKeys).toEqual({
      product_id: 'Product',
      variant_id: 'Variant',
    })
  })

  // MOD-07 — Module() generates linkable config from models
  it('generates linkable config from models', () => {
    const mod = Module('product', {
      service: ProductModuleService,
      models: {
        Product: { name: 'Product' },
      },
    })

    expect(mod.linkable).toBeDefined()
    expect(mod.linkable!.product_id).toEqual({
      serviceName: 'product',
      entity: 'Product',
      primaryKey: 'id',
      field: 'product_id',
    })
  })

  // MOD-08 — defineModule() works as alias
  it('defineModule() works with explicit config', () => {
    const mod = defineModule({
      service: ProductModuleService,
      name: 'product',
      version: '2.0.0',
    })

    expect(mod.service).toBe(ProductModuleService)
    expect(mod.name).toBe('product')
    expect(mod.version).toBe('2.0.0')
  })

  // MOD-09 — defineModule() without models has no linkableKeys
  it('defineModule() without models has undefined linkableKeys', () => {
    const mod = defineModule({ service: ProductModuleService, name: 'product' })
    expect(mod.linkableKeys).toBeUndefined()
  })
})
