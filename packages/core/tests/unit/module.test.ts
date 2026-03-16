import { describe, it, expect } from 'vitest'
import { Module, defineModule } from '@manta/core'

describe('Module System', () => {
  class ProductService {}
  class OrderService {}

  // MOD-01 — Module() wraps a service class
  it('Module() wraps a service class into ModuleExports', () => {
    const mod = Module(ProductService)
    expect(mod.service).toBe(ProductService)
    expect(mod.name).toBe('product')
  })

  // MOD-02 — Module() derives name from service class
  it('derives name by stripping "Service" suffix', () => {
    expect(Module(ProductService).name).toBe('product')
    expect(Module(OrderService).name).toBe('order')
  })

  // MOD-03 — Module() accepts custom name
  it('accepts custom name override', () => {
    const mod = Module(ProductService, { name: 'my-product' })
    expect(mod.name).toBe('my-product')
  })

  // MOD-04 — Module() accepts lifecycle hooks
  it('accepts lifecycle hooks', () => {
    let started = false
    const mod = Module(ProductService, {
      hooks: {
        onApplicationStart: () => { started = true },
      },
    })

    expect(mod.hooks).toBeDefined()
    mod.hooks!.onApplicationStart!()
    expect(started).toBe(true)
  })

  // MOD-05 — Module() accepts loaders
  it('accepts loaders', () => {
    const loader = async () => {}
    const mod = Module(ProductService, { loaders: [loader] })
    expect(mod.loaders).toHaveLength(1)
    expect(mod.loaders![0]).toBe(loader)
  })

  // MOD-06 — Module() accepts version
  it('accepts version', () => {
    const mod = Module(ProductService, { version: '1.0.0' })
    expect(mod.version).toBe('1.0.0')
  })

  // MOD-07 — defineModule() with explicit config
  it('defineModule() works with explicit config', () => {
    const mod = defineModule({
      service: ProductService,
      name: 'product',
      version: '2.0.0',
    })

    expect(mod.service).toBe(ProductService)
    expect(mod.name).toBe('product')
    expect(mod.version).toBe('2.0.0')
  })

  // MOD-08 — defineModule() generates linkableKeys from models
  it('defineModule() generates linkableKeys from models', () => {
    const mod = defineModule({
      service: ProductService,
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

  // MOD-09 — defineModule() without models has no linkableKeys
  it('defineModule() without models has undefined linkableKeys', () => {
    const mod = defineModule({ service: ProductService })
    expect(mod.linkableKeys).toBeUndefined()
  })
})
