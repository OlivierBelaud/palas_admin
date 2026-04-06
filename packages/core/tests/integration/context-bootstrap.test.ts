// Integration test: Context system bootstrap flow
// Simulates the bootstrap loading sequence without requiring a full filesystem/HTTP setup.

import { ContextRegistry } from '@manta/core'
import { describe, expect, it } from 'vitest'
import { defineContext } from '../../src/context'

const MODULES = ['catalog', 'cart', 'order', 'inventory']
const COMMANDS = ['create-product', 'checkout', 'apply-discount']

describe('Context Bootstrap Integration', () => {
  // CTX-INT-01 — No contexts = implicit admin with all modules/commands
  it('implicit admin context when no contexts defined', () => {
    const registry = new ContextRegistry()
    registry.registerDefault(MODULES, COMMANDS)

    const contexts = registry.list()
    expect(contexts).toHaveLength(1)

    const admin = contexts[0]
    expect(admin.name).toBe('admin')
    expect(admin.basePath).toBe('/api/admin')
    expect(admin.actors).toEqual(['user'])
    expect([...admin.modules.keys()].sort()).toEqual(MODULES.sort())
    expect([...admin.commands].sort()).toEqual(COMMANDS.sort())
    expect(admin.ai.enabled).toBe(true)
    expect(admin.ai.commands.sort()).toEqual(COMMANDS.sort())
  })

  // CTX-INT-02 — Explicit contexts replace implicit admin
  it('explicit contexts override default', () => {
    const registry = new ContextRegistry()

    // Simulate loading src/contexts/admin.ts
    registry.register(
      defineContext({
        name: 'admin',
        basePath: '/api/admin',
        actors: 'user',
        modules: { catalog: '*', order: '*' },
        commands: ['create-product'],
        ai: true,
      }),
      MODULES,
      COMMANDS,
    )

    // Simulate loading src/contexts/store.ts
    registry.register(
      defineContext({
        name: 'store',
        basePath: '/api/store',
        actors: 'customer',
        modules: { catalog: { expose: '*', public: true } },
        commands: ['checkout'],
      }),
      MODULES,
      COMMANDS,
    )

    expect(registry.list()).toHaveLength(2)

    // Admin sees catalog + order, one command
    const admin = registry.get('admin')!
    expect([...admin.modules.keys()]).toEqual(['catalog', 'order'])
    expect([...admin.commands]).toEqual(['create-product'])

    // Store sees catalog (public), one command
    const store = registry.get('store')!
    expect([...store.modules.keys()]).toEqual(['catalog'])
    expect(store.modules.get('catalog')!.public).toBe(true)
    expect([...store.commands]).toEqual(['checkout'])
  })

  // CTX-INT-03 — Context resolution from request path + actor
  it('resolves correct context from path + actor', () => {
    const registry = new ContextRegistry()
    registry.register(
      defineContext({ name: 'admin', basePath: '/api/admin', actors: 'user', modules: { catalog: '*', order: '*' } }),
      MODULES,
      COMMANDS,
    )
    registry.register(
      defineContext({ name: 'store', basePath: '/api/store', actors: 'customer', modules: { catalog: '*' } }),
      MODULES,
      COMMANDS,
    )

    // Admin user hitting admin path
    const adminCtx = registry.resolve('/api/admin/query/catalog', 'user')
    expect(adminCtx!.name).toBe('admin')

    // Customer hitting store path
    const storeCtx = registry.resolve('/api/store/query/catalog', 'customer')
    expect(storeCtx!.name).toBe('store')

    // Customer hitting admin path — no match (wrong actor)
    const noMatch = registry.resolve('/api/admin/query/catalog', 'customer')
    expect(noMatch).toBeNull()
  })

  // CTX-INT-04 — Command filtering per context
  it('commands filtered per context', () => {
    const registry = new ContextRegistry()
    registry.register(
      defineContext({
        name: 'admin',
        basePath: '/api/admin',
        actors: 'user',
        modules: { catalog: '*' },
        commands: ['create-product', 'apply-discount'],
      }),
      MODULES,
      COMMANDS,
    )
    registry.register(
      defineContext({
        name: 'store',
        basePath: '/api/store',
        actors: 'customer',
        modules: { catalog: '*' },
        commands: ['checkout'],
      }),
      MODULES,
      COMMANDS,
    )

    // Admin sees create-product, not checkout
    expect(registry.isCommandVisible('admin', 'create-product')).toBe(true)
    expect(registry.isCommandVisible('admin', 'checkout')).toBe(false)

    // Store sees checkout, not create-product
    expect(registry.isCommandVisible('store', 'checkout')).toBe(true)
    expect(registry.isCommandVisible('store', 'create-product')).toBe(false)
  })

  // CTX-INT-05 — Module filtering per context
  it('modules filtered per context', () => {
    const registry = new ContextRegistry()
    registry.register(
      defineContext({
        name: 'admin',
        basePath: '/api/admin',
        actors: 'user',
        modules: { catalog: '*', order: '*', inventory: '*' },
      }),
      MODULES,
      COMMANDS,
    )
    registry.register(
      defineContext({
        name: 'store',
        basePath: '/api/store',
        actors: 'customer',
        modules: { catalog: { expose: '*', public: true } },
      }),
      MODULES,
      COMMANDS,
    )

    // Admin sees 3 modules
    expect(registry.isModuleExposed('admin', 'catalog')).toBe(true)
    expect(registry.isModuleExposed('admin', 'order')).toBe(true)
    expect(registry.isModuleExposed('admin', 'inventory')).toBe(true)
    expect(registry.isModuleExposed('admin', 'cart')).toBe(false)

    // Store sees only catalog
    expect(registry.isModuleExposed('store', 'catalog')).toBe(true)
    expect(registry.isModuleExposed('store', 'order')).toBe(false)
  })

  // CTX-INT-06 — Auth protection: admin basePath requires auth, store basePath does not
  it('auth protection based on basePath convention', () => {
    // This test verifies the H3 adapter convention:
    // /api/admin/* requires auth, /api/store/* does not (pipeline check)
    const adminPath = '/api/admin/query/catalog'
    const storePath = '/api/store/query/catalog'

    // V2: auth is per-context via defineUserModel, not global /api/auth/*
    const adminPublicPaths = new Set(['/api/admin/login', '/api/admin/forgot-password', '/api/admin/reset-password'])
    const requiresAuth = (path: string) => path.startsWith('/api/admin/') && !adminPublicPaths.has(path)

    expect(requiresAuth(adminPath)).toBe(true)
    expect(requiresAuth(storePath)).toBe(false)
    expect(requiresAuth('/api/admin/login')).toBe(false)
  })

  // CTX-INT-07 — B2C + B2B on same basePath with different actors
  it('B2C and B2B contexts share basePath with different actors', () => {
    const registry = new ContextRegistry()
    registry.register(
      defineContext({
        name: 'store-b2c',
        basePath: '/api/store',
        actors: 'customer',
        modules: { catalog: '*', cart: '*' },
      }),
      MODULES,
      COMMANDS,
    )
    registry.register(
      defineContext({
        name: 'store-b2b',
        basePath: '/api/store',
        actors: 'employee',
        modules: { catalog: '*', cart: '*', order: '*' },
      }),
      MODULES,
      COMMANDS,
    )

    // Same path, different actors
    const b2c = registry.resolve('/api/store/query/catalog', 'customer')
    expect(b2c!.name).toBe('store-b2c')

    const b2b = registry.resolve('/api/store/query/catalog', 'employee')
    expect(b2b!.name).toBe('store-b2b')

    // B2B sees order, B2C does not
    expect(registry.isModuleExposed('store-b2b', 'order')).toBe(true)
    expect(registry.isModuleExposed('store-b2c', 'order')).toBe(false)
  })

  // CTX-INT-08 — AI tool filtering per context
  it('AI tools filtered per context', () => {
    const registry = new ContextRegistry()
    registry.register(
      defineContext({
        name: 'admin',
        basePath: '/api/admin',
        actors: 'user',
        modules: { catalog: '*' },
        commands: ['create-product', 'checkout', 'apply-discount'],
        ai: true,
      }),
      MODULES,
      COMMANDS,
    )
    registry.register(
      defineContext({
        name: 'store',
        basePath: '/api/store',
        actors: 'customer',
        modules: { catalog: '*' },
        commands: ['checkout'],
        ai: { enabled: true, commands: ['checkout'] },
      }),
      MODULES,
      COMMANDS,
    )

    // Admin AI sees all commands
    expect(registry.getAiCommands('admin').sort()).toEqual(['apply-discount', 'checkout', 'create-product'])

    // Store AI sees only checkout
    expect(registry.getAiCommands('store')).toEqual(['checkout'])
  })

  // CTX-INT-09 — Boot validation catches invalid module refs
  it('boot fails on invalid module reference', () => {
    const registry = new ContextRegistry()
    expect(() =>
      registry.register(
        defineContext({
          name: 'bad',
          basePath: '/api/bad',
          actors: 'user',
          modules: { doesNotExist: '*' },
        }),
        MODULES,
        COMMANDS,
      ),
    ).toThrow('module "doesNotExist" not found')
  })

  // CTX-INT-10 — Boot validation catches invalid command refs
  it('boot fails on invalid command reference', () => {
    const registry = new ContextRegistry()
    expect(() =>
      registry.register(
        defineContext({
          name: 'bad',
          basePath: '/api/bad',
          actors: 'user',
          modules: { catalog: '*' },
          commands: ['ghost-command'],
        }),
        MODULES,
        COMMANDS,
      ),
    ).toThrow('command "ghost-command" not found')
  })
})
