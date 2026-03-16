// Strict Mode Tests — SM-01 to SM-06
// Tests both normal mode (warnings/graceful) and strict mode (errors/fatal)

import { describe, it, expect } from 'vitest'
import {
  checkRouteConflicts,
  checkUnboundedRelations,
  getEntityThreshold,
  checkLinkLocations,
  checkAutoDiscovery,
  checkEventNameAutoGeneration,
} from '../../src/strict-mode'
import { MantaError } from '../../src/errors/manta-error'

describe('Strict Mode Tests', () => {
  // SM-01 -- SPEC-068/140: route conflict inter-plugins
  describe('Route conflict inter-plugins', () => {
    it('normal mode: warning + last-wins', () => {
      const routes = [
        { method: 'GET', path: '/admin/products', source: 'plugin-a' },
        { method: 'GET', path: '/admin/products', source: 'plugin-b' },
      ]
      const result = checkRouteConflicts(routes, false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('last-wins')
    })

    it('strict mode: MantaError at boot', () => {
      const routes = [
        { method: 'GET', path: '/admin/products', source: 'plugin-a' },
        { method: 'GET', path: '/admin/products', source: 'plugin-b' },
      ]
      expect(() => checkRouteConflicts(routes, true)).toThrow(MantaError)
      try {
        checkRouteConflicts(routes, true)
      } catch (err) {
        expect(MantaError.is(err)).toBe(true)
        expect((err as MantaError).type).toBe('INVALID_STATE')
      }
    })
  })

  // SM-02 -- SPEC-011: dangerouslyUnboundedRelations
  describe('dangerouslyUnboundedRelations', () => {
    it('normal mode: allowed with warning', () => {
      const result = checkUnboundedRelations({ dangerouslyUnboundedRelations: true }, false)
      expect(result.allowed).toBe(true)
      expect(result.warning).toBeDefined()
    })

    it('strict mode: MantaError forbidden', () => {
      expect(() => checkUnboundedRelations({ dangerouslyUnboundedRelations: true }, true))
        .toThrow(MantaError)
    })
  })

  // SM-03 -- SPEC-011: hard threshold Query.graph()
  describe('Hard threshold Query.graph()', () => {
    it('normal mode: 10000 entities default', () => {
      const threshold = getEntityThreshold(false)
      expect(threshold).toBe(10000)
    })

    it('strict mode: 5000 entities default', () => {
      const threshold = getEntityThreshold(true)
      expect(threshold).toBe(5000)
    })
  })

  // SM-04 -- SPEC-012: link outside src/links/
  describe('Link outside src/links/', () => {
    it('normal mode: silently ignored with warning', () => {
      const links = [
        { id: 'valid-link', path: '/project/src/links/product-order.ts' },
        { id: 'bad-link', path: '/project/src/modules/product/my-link.ts' },
      ]
      const result = checkLinkLocations(links, false)
      expect(result.valid).toHaveLength(1)
      expect(result.invalid).toHaveLength(1)
      expect(result.warnings).toHaveLength(1)
    })

    it('strict mode: error at boot', () => {
      const links = [
        { id: 'bad-link', path: '/project/src/modules/product/my-link.ts' },
      ]
      expect(() => checkLinkLocations(links, true)).toThrow(MantaError)
    })
  })

  // SM-05 -- SPEC-074: auto-discovery filesystem
  describe('Auto-discovery filesystem', () => {
    it('normal mode: active (scan dirs)', () => {
      const result = checkAutoDiscovery(false, false)
      expect(result.useAutoDiscovery).toBe(true)
    })

    it('strict mode: disabled (manifest required)', () => {
      expect(() => checkAutoDiscovery(true, false)).toThrow(MantaError)

      // With manifest, strict mode works
      const result = checkAutoDiscovery(true, true)
      expect(result.useAutoDiscovery).toBe(false)
    })
  })

  // SM-06 -- SPEC-127: event name auto-generation
  describe('Event name auto-generation', () => {
    it('normal mode: active', () => {
      const result = checkEventNameAutoGeneration(false, false)
      expect(result.autoGenerate).toBe(true)
    })

    it('strict mode: disabled (explicit declaration required)', () => {
      expect(() => checkEventNameAutoGeneration(true, false)).toThrow(MantaError)

      // With explicit events, strict mode works
      const result = checkEventNameAutoGeneration(true, true)
      expect(result.autoGenerate).toBe(false)
    })
  })
})
