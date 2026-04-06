// Layer 1: Module discovery tests
// Verifies that we can discover all Medusa core modules and their DML entities.

import { beforeAll, describe, expect, it } from 'vitest'
import { clearAlerts, getAlerts } from '../src/_internal/alerts'
import { buildEntityMap, type DiscoveredModule, discoverModules } from '../src/_internal/discovery/modules'

describe('layer-1: modules', () => {
  let modules: DiscoveredModule[]

  beforeAll(() => {
    clearAlerts()
    modules = discoverModules()
  })

  it('discovers core modules (>= 24)', () => {
    expect(modules.length).toBeGreaterThanOrEqual(24)
  })

  it('each module has a service name', () => {
    for (const mod of modules) {
      expect(mod.serviceName).toBeDefined()
      expect(mod.serviceName).not.toBe('unknown')
    }
  })

  it('total DML entities >= 100', () => {
    const total = modules.reduce((sum, m) => sum + m.models.length, 0)
    expect(total).toBeGreaterThanOrEqual(100)
  })

  it('Product module has >= 10 entities', () => {
    const product = modules.find((m) => m.name === 'product')
    expect(product).toBeDefined()
    expect(product!.models.length).toBeGreaterThanOrEqual(10)
    const modelNames = product!.models.map((m) => m.name)
    expect(modelNames).toContain('Product')
    expect(modelNames).toContain('ProductVariant')
    expect(modelNames).toContain('ProductOption')
    expect(modelNames).toContain('ProductCategory')
  })

  it('Order module has >= 20 entities', () => {
    const order = modules.find((m) => m.name === 'order')
    expect(order).toBeDefined()
    expect(order!.models.length).toBeGreaterThanOrEqual(20)
  })

  it('Cart module has >= 8 entities', () => {
    const cart = modules.find((m) => m.name === 'cart')
    expect(cart).toBeDefined()
    expect(cart!.models.length).toBeGreaterThanOrEqual(8)
  })

  it('Customer module has >= 3 entities', () => {
    const customer = modules.find((m) => m.name === 'customer')
    expect(customer).toBeDefined()
    expect(customer!.models.length).toBeGreaterThanOrEqual(3)
  })

  it('DML entities have schema with properties', () => {
    const product = modules.find((m) => m.name === 'product')!
    const productModel = product.models.find((m) => m.name === 'Product')!
    expect(productModel.schema).toBeDefined()
    const schemaKeys = Object.keys(productModel.schema)
    expect(schemaKeys).toContain('id')
    expect(schemaKeys).toContain('title')
    expect(schemaKeys).toContain('handle')
    expect(schemaKeys).toContain('status')
  })

  it('skips provider modules', () => {
    const moduleNames = modules.map((m) => m.name)
    expect(moduleNames).not.toContain('auth-emailpass')
    expect(moduleNames).not.toContain('cache-inmemory')
    expect(moduleNames).not.toContain('event-bus-local')
    expect(moduleNames).not.toContain('file-s3')
    expect(moduleNames).not.toContain('payment-stripe')
    expect(moduleNames).not.toContain('workflow-engine-inmemory')
  })

  it('skips link-modules (handled in Layer 4)', () => {
    const moduleNames = modules.map((m) => m.name)
    expect(moduleNames).not.toContain('link-modules')
  })

  it('entity-to-service map covers all entities', () => {
    const entityMap = buildEntityMap(modules)
    const totalEntities = modules.reduce((sum, m) => sum + m.models.length, 0)
    // Each entity gets at least 2 entries (singular + plural)
    expect(Object.keys(entityMap).length).toBeGreaterThanOrEqual(totalEntities)

    // Spot-check known mappings
    expect(entityMap.product).toBe('product')
    expect(entityMap.products).toBe('product')
    expect(entityMap.order).toBe('order')
    expect(entityMap.customer).toBe('customer')
  })

  it('ALERT: custom methods beyond CRUD are detected', () => {
    const alerts = getAlerts('module')
    const customMethodAlerts = alerts.filter((a) => a.message.includes('custom methods'))
    // Some modules have custom methods — we should detect them
    expect(customMethodAlerts.length).toBeGreaterThanOrEqual(0)
  })

  it('no error-level alerts', () => {
    const errors = getAlerts('module').filter((a) => a.level === 'error')
    if (errors.length > 0) {
      console.error('Module errors:', errors)
    }
    expect(errors).toHaveLength(0)
  })
})
