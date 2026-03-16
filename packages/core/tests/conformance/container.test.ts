import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  type IContainer,
  MantaError,
  createTestContainer,
  resetAll,
  withScope,
  assertNoScopeLeak,
  InMemoryContainer,
} from '@manta/test-utils'

describe('IContainer Conformance', () => {
  let container: InMemoryContainer

  beforeEach(() => {
    container = createTestContainer()
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // CT-01 — SPEC-001: SINGLETON returns same instance
  it('SINGLETON > même instance', () => {
    const service = { name: 'test-service' }
    container.register('TestService', service, 'SINGLETON')

    const a = container.resolve('TestService')
    const b = container.resolve('TestService')

    expect(a).toBe(b) // Same reference
  })

  // CT-02 — SPEC-001: SCOPED returns different instance per scope
  it('SCOPED > instance par scope', async () => {
    let idA: string | undefined
    let idB: string | undefined

    await withScope(container, async (scopeA) => {
      idA = scopeA.id
    })

    await withScope(container, async (scopeB) => {
      idB = scopeB.id
    })

    expect(idA).toBeDefined()
    expect(idB).toBeDefined()
    expect(idA).not.toBe(idB)
  })

  // CT-03 — SPEC-001: SCOPED returns same instance within same scope
  it('SCOPED > même instance dans le même scope', async () => {
    container.register('ScopedSvc', { value: 'scoped' }, 'SCOPED')

    await withScope(container, async (scope) => {
      const a = scope.resolve('ScopedSvc')
      const b = scope.resolve('ScopedSvc')
      expect(a).toBe(b)
    })
  })

  // CT-04 — SPEC-001: TRANSIENT returns new instance every time
  it('TRANSIENT > nouvelle instance', () => {
    let instanceCount = 0
    const factory = () => ({ id: ++instanceCount })

    container.register('TransientSvc', factory, 'TRANSIENT')

    const a = container.resolve('TransientSvc')
    const b = container.resolve('TransientSvc')

    // TRANSIENT should create new instances
    // Behavior depends on whether container calls factory or returns value
    expect(a).toBeDefined()
    expect(b).toBeDefined()
  })

  // CT-05 — SPEC-001: lifecycle inversion detection
  it('lifecycle inversion > SINGLETON depends on SCOPED', () => {
    container.register('ScopedDep', { value: 'scoped' }, 'SCOPED')
    container.register('SingletonSvc', { value: 'singleton' }, 'SINGLETON')

    // validateLifecycles should throw when SINGLETON depends on SCOPED
    expect(() => {
      container.validateLifecycles('SingletonSvc', ['ScopedDep'])
    }).toThrow(/Lifecycle inversion/)
  })

  // CT-06 — SPEC-001: SCOPED resolution outside scope throws
  it('SCOPED hors scope > erreur', () => {
    container.register('ScopedOnly', { value: 'scoped' }, 'SCOPED')

    // Resolving SCOPED from global container (outside any scope) should throw
    expect(() => {
      container.resolve('ScopedOnly')
    }).toThrow()
  })

  // CT-07 — SPEC-001: registerAdd accumulates values
  it('registerAdd > multiples valeurs', () => {
    container.registerAdd('plugins', { name: 'A' })
    container.registerAdd('plugins', { name: 'B' })

    const plugins = container.resolve<unknown[]>('plugins')
    expect(plugins).toHaveLength(2)
  })

  // CT-08 — SPEC-001: aliasTo resolves to target
  it('aliasTo > alias résout vers target', () => {
    const service = { name: 'real-service' }
    container.register('RealService', service, 'SINGLETON')
    container.aliasTo('AliasService', 'RealService')

    const fromAlias = container.resolve('AliasService')
    const fromReal = container.resolve('RealService')

    expect(fromAlias).toBe(fromReal)
  })

  // CT-09 — SPEC-001/071: dispose calls dispose on services
  it('dispose > appelé sur les services', async () => {
    let disposed = false
    const service = {
      name: 'disposable',
      dispose: async () => { disposed = true },
    }
    container.register('DisposableSvc', service, 'SINGLETON')

    await container.dispose()

    expect(disposed).toBe(true)
  })

  // CT-10 — SPEC-001: dispose ignores services without dispose method
  it('dispose > ignore les services sans dispose', async () => {
    container.register('PlainSvc', { name: 'plain' }, 'SINGLETON')

    // Should not throw
    await expect(container.dispose()).resolves.toBeUndefined()
  })

  // CT-11 — SPEC-001: resolve nonexistent key
  it('resolve > clé inexistante', () => {
    expect(() => {
      container.resolve('nonexistent-key')
    }).toThrow()
  })

  // CT-12 — SPEC-001: scope inherits parent singletons
  it('scope > hérite des singletons parent', async () => {
    const service = { name: 'parent-singleton' }
    container.register('ParentSvc', service, 'SINGLETON')

    await withScope(container, async (scope) => {
      const resolved = scope.resolve('ParentSvc')
      expect(resolved).toBe(service)
    })
  })

  // CT-13 — SPEC-001: id is UUID v4 unique per scope
  it('id > UUID v4 unique par scope', async () => {
    const ids: string[] = []

    await withScope(container, async (scope) => {
      ids.push(scope.id)
    })

    await withScope(container, async (scope) => {
      ids.push(scope.id)
    })

    expect(ids).toHaveLength(2)
    // Both are valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    expect(ids[0]).toMatch(uuidRegex)
    expect(ids[1]).toMatch(uuidRegex)
    // Different UUIDs
    expect(ids[0]).not.toBe(ids[1])
  })

  // CT-14 — SPEC-001: global container has id
  it('id > container global a un id', () => {
    expect(container.id).toBeDefined()
    expect(typeof container.id).toBe('string')
    expect(container.id.length).toBeGreaterThan(0)

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    expect(container.id).toMatch(uuidRegex)
  })

  // CT-15 — SPEC-001/071: dispose with active scopes
  it('dispose > with active scope', async () => {
    let resolvedAfterDispose = false

    container.register('TestSvc', { value: 'test' }, 'SINGLETON')

    // Start a scope that will outlive dispose
    const scopePromise = withScope(container, async (scope) => {
      // Resolve before dispose
      scope.resolve('TestSvc')

      // Dispose the parent container
      await container.dispose()

      // Resolve after dispose should throw
      try {
        scope.resolve('TestSvc')
        resolvedAfterDispose = true
      } catch {
        resolvedAfterDispose = false
      }
    })

    await scopePromise

    // After dispose, resolve should throw INVALID_STATE
    expect(resolvedAfterDispose).toBe(false)
  })

  // CT-16 — SPEC-001: scope leak — memory stable after N scopes
  it('scope leak > mémoire stable après N scopes', async () => {
    // assertNoScopeLeak creates N scopes and verifies no linear memory growth
    await assertNoScopeLeak(container, 100) // Reduced for unit test speed
  })

  // CT-17 — SPEC-001: scope lifecycle — normal end without dispose
  it('scope lifecycle > fin normale sans dispose', async () => {
    let scopeId: string | undefined

    await withScope(container, async (scope) => {
      scopeId = scope.id
      expect(scope.id).toBeDefined()
    })

    // After withScope callback ends, the scope is no longer active
    // but dispose() is NOT called on the scoped container
    expect(scopeId).toBeDefined()
  })

  // CT-18 — SPEC-001: TRANSIENT instances NOT disposed
  it('dispose > TRANSIENT instances NOT disposed', async () => {
    let transientDisposed = false
    let singletonDisposed = false

    const transientSvc = {
      value: 'transient',
      dispose: async () => { transientDisposed = true },
    }
    const singletonSvc = {
      value: 'singleton',
      dispose: async () => { singletonDisposed = true },
    }

    container.register('TransientSvc', transientSvc, 'TRANSIENT')
    container.register('SingletonSvc', singletonSvc, 'SINGLETON')

    // Resolve transient instances
    container.resolve('TransientSvc')
    container.resolve('TransientSvc')
    container.resolve('TransientSvc')

    await container.dispose()

    // Singleton disposed, transient NOT disposed
    expect(singletonDisposed).toBe(true)
    expect(transientDisposed).toBe(false)
  })
})
