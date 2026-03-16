// Phase 7 -- Module versioning (SPEC-135)
// Tests for version checking at boot time

import { describe, it, expect, vi } from 'vitest'
import { ModuleVersionChecker, type ModuleVersionStore } from '../../src/module/versioning'
import type { ModuleExports } from '../../src/module'

describe('Module versioning (SPEC-135)', () => {
  function createStore(stored: Record<string, string> = {}): ModuleVersionStore {
    const versions = new Map(Object.entries(stored))
    return {
      getVersion: vi.fn(async (name: string) => versions.get(name) ?? null),
      setVersion: vi.fn(async (name: string, version: string) => {
        versions.set(name, version)
      }),
    }
  }

  function makeModule(name: string, version?: string): ModuleExports {
    return {
      name,
      service: class {},
      version,
    }
  }

  // MV-01 -- First load stores version
  it('MV-01 -- first load stores module version in store', async () => {
    const store = createStore()
    const checker = new ModuleVersionChecker(store)

    const result = await checker.checkModules([makeModule('product', '1.0.0')])

    expect(result.ok).toBe(true)
    expect(store.setVersion).toHaveBeenCalledWith('product', '1.0.0')
  })

  // MV-02 -- Matching version passes
  it('MV-02 -- matching version passes without error', async () => {
    const store = createStore({ product: '1.0.0' })
    const checker = new ModuleVersionChecker(store)

    const result = await checker.checkModules([makeModule('product', '1.0.0')])

    expect(result.ok).toBe(true)
    expect(result.mismatches).toHaveLength(0)
  })

  // MV-03 -- Upgrade detected (code > DB)
  it('MV-03 -- upgrade detected when code version > stored version', async () => {
    const store = createStore({ product: '1.0.0' })
    const checker = new ModuleVersionChecker(store)

    const result = await checker.checkModules([makeModule('product', '2.0.0')])

    expect(result.ok).toBe(true)
    expect(result.upgrades).toHaveLength(1)
    expect(result.upgrades[0]).toEqual({
      name: 'product',
      from: '1.0.0',
      to: '2.0.0',
    })
    expect(store.setVersion).toHaveBeenCalledWith('product', '2.0.0')
  })

  // MV-04 -- Downgrade detected (code < DB) = error
  it('MV-04 -- downgrade detected when code version < stored version', async () => {
    const store = createStore({ product: '2.0.0' })
    const checker = new ModuleVersionChecker(store)

    const result = await checker.checkModules([makeModule('product', '1.0.0')])

    expect(result.ok).toBe(false)
    expect(result.mismatches).toHaveLength(1)
    expect(result.mismatches[0]!.type).toBe('downgrade')
  })

  // MV-05 -- Module without version is skipped
  it('MV-05 -- module without version is skipped', async () => {
    const store = createStore()
    const checker = new ModuleVersionChecker(store)

    const result = await checker.checkModules([makeModule('product')])

    expect(result.ok).toBe(true)
    expect(store.setVersion).not.toHaveBeenCalled()
  })

  // MV-06 -- Multiple modules checked at once
  it('MV-06 -- checks multiple modules', async () => {
    const store = createStore({ product: '1.0.0' })
    const checker = new ModuleVersionChecker(store)

    const result = await checker.checkModules([
      makeModule('product', '1.0.0'),
      makeModule('order', '1.0.0'),
    ])

    expect(result.ok).toBe(true)
    expect(store.setVersion).toHaveBeenCalledWith('order', '1.0.0')
  })
})
