// Layer 0: Shim tests
// Verifies that the utils proxy correctly loads 620+ exports from @medusajs/utils
// and overrides 10-15 infrastructure exports with Manta equivalents.

import { createService, MantaError, Module } from '@manta/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { clearAlerts } from '../src/_internal/alerts'
import { installShim, type ShimReport } from '../src/_internal/shim/install'
import { isOverridden, OVERRIDDEN_KEYS, shimmedUtils } from '../src/_internal/shim/utils-proxy'

describe('layer-0: shim', () => {
  let report: ShimReport

  beforeAll(() => {
    clearAlerts()
    report = installShim()
  })

  it('shim installs correctly', () => {
    expect(report).toBeDefined()
    expect(report.totalExports).toBeGreaterThan(0)
    expect(report.alerts.filter((a) => a.level === 'error')).toHaveLength(0)
  })

  it('utils proxy exports 620+ symbols', () => {
    expect(report.realUtilsCount).toBeGreaterThanOrEqual(600)
    expect(report.totalExports).toBeGreaterThanOrEqual(600)
  })

  it('MedusaService is our wrapper, not Medusa original', () => {
    expect(shimmedUtils.MedusaService).toBe(createService)
    expect(shimmedUtils.MedusaInternalService).toBe(createService)
  })

  it('Module is Manta Module', () => {
    expect(shimmedUtils.Module).toBe(Module)
  })

  it('MedusaError is MantaError', () => {
    expect(shimmedUtils.MedusaError).toBe(MantaError)
  })

  it('MedusaErrorTypes has all expected types', () => {
    const types = shimmedUtils.MedusaErrorTypes
    expect(types).toBeDefined()
    expect(types.NOT_FOUND).toBe('NOT_FOUND')
    expect(types.UNAUTHORIZED).toBe('UNAUTHORIZED')
    expect(types.INVALID_DATA).toBe('INVALID_DATA')
    expect(types.DUPLICATE_ERROR).toBe('DUPLICATE_ERROR')
    expect(types.UNEXPECTED_STATE).toBe('UNEXPECTED_STATE')
  })

  it('decorators are no-ops', () => {
    // InjectManager returns a decorator factory that returns descriptor unchanged
    const decorator = shimmedUtils.InjectManager()
    const desc = { value: 'test' }
    expect(decorator({}, 'key', desc)).toBe(desc)

    // InjectTransactionManager same
    const decorator2 = shimmedUtils.InjectTransactionManager()
    expect(decorator2({}, 'key', desc)).toBe(desc)

    // MedusaContext returns a parameter decorator (no-op)
    const paramDecorator = shimmedUtils.MedusaContext()
    expect(() => paramDecorator({}, 'key', 0)).not.toThrow()

    // EmitEvents returns a no-op decorator
    const decorator3 = shimmedUtils.EmitEvents()
    expect(decorator3({}, 'key', desc)).toBe(desc)
  })

  it('MikroORM stubs do not throw', () => {
    // toMikroORMEntity returns a class
    const stub = shimmedUtils.toMikroORMEntity()
    expect(typeof stub).toBe('function')
    expect(() => new stub()).not.toThrow()

    // DALUtils stubs
    expect(shimmedUtils.DALUtils.MikroOrmBase).toBeDefined()
    expect(typeof shimmedUtils.DALUtils.MikroOrmBase).toBe('function')
  })

  it('Modules enum is preserved from @medusajs/utils', () => {
    const modules = shimmedUtils.Modules
    expect(modules).toBeDefined()
    expect(modules.PRODUCT).toBeDefined()
    expect(modules.ORDER).toBeDefined()
    expect(modules.CUSTOMER).toBeDefined()
    expect(modules.CART).toBeDefined()
    expect(modules.PAYMENT).toBeDefined()
    expect(modules.PRICING).toBeDefined()
    expect(modules.INVENTORY).toBeDefined()
    expect(modules.FULFILLMENT).toBeDefined()
    expect(modules.AUTH).toBeDefined()
    expect(modules.USER).toBeDefined()
    expect(modules.REGION).toBeDefined()
    expect(modules.TAX).toBeDefined()
    expect(modules.SALES_CHANNEL).toBeDefined()
    expect(modules.STORE).toBeDefined()
    expect(modules.WORKFLOW_ENGINE).toBeDefined()
  })

  it('ContainerRegistrationKeys is preserved', () => {
    const keys = shimmedUtils.ContainerRegistrationKeys
    expect(keys).toBeDefined()
    expect(keys.PG_CONNECTION).toBeDefined()
    expect(keys.MANAGER).toBeDefined()
    expect(keys.LOGGER).toBeDefined()
    expect(keys.REMOTE_QUERY).toBeDefined()
    expect(keys.QUERY).toBeDefined()
  })

  it('all other exports are passed through unchanged', () => {
    // Spot-check business exports that must NOT be overridden
    const mustPreserve = ['Modules', 'ContainerRegistrationKeys', 'isString', 'isObject']
    for (const key of mustPreserve) {
      expect(shimmedUtils[key]).toBeDefined()
      expect(isOverridden(key)).toBe(false)
    }
  })

  it('overridden keys list is correct', () => {
    expect(OVERRIDDEN_KEYS).toContain('MedusaService')
    expect(OVERRIDDEN_KEYS).toContain('Module')
    expect(OVERRIDDEN_KEYS).toContain('MedusaError')
    expect(OVERRIDDEN_KEYS).toContain('InjectManager')
    expect(OVERRIDDEN_KEYS).toContain('toMikroORMEntity')
    expect(OVERRIDDEN_KEYS).toContain('DALUtils')
    expect(OVERRIDDEN_KEYS.length).toBe(13)
  })

  it('report summary is consistent', () => {
    expect(report.overriddenCount).toBe(OVERRIDDEN_KEYS.length)
    expect(report.passedThroughCount).toBe(report.totalExports - report.overriddenCount)
    expect(report.realUtilsCount).toBeGreaterThanOrEqual(600)
  })
})
