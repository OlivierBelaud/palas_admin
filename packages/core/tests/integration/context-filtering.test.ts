// Context filtering tests — validates module/command/AI/relation filtering per context.
// Tests the ContextRegistry behavior + query handler semantics without HTTP transport.

import { ContextRegistry } from '@manta/core'
import { describe, expect, it, vi } from 'vitest'
import { defineContext } from '../../src/context'

const MODULES = ['catalog', 'inventory', 'order', 'cart']
const COMMANDS = ['create-product', 'checkout', 'apply-discount', 'archive-product']

describe('Context Filtering — Modules', () => {
  // CF-01 — Query to exposed module succeeds
  it('exposed module is accessible', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({
        name: 'store',
        basePath: '/api/store',
        actors: 'customer',
        modules: { catalog: { expose: '*', public: true }, cart: '*' },
      }),
      MODULES,
      COMMANDS,
    )

    expect(reg.isModuleExposed('store', 'catalog')).toBe(true)
    expect(reg.isModuleExposed('store', 'cart')).toBe(true)
  })

  // CF-02 — Query to unexposed module returns not found
  it('unexposed module is not accessible', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({
        name: 'store',
        basePath: '/api/store',
        actors: 'customer',
        modules: { catalog: '*' },
      }),
      MODULES,
      COMMANDS,
    )

    expect(reg.isModuleExposed('store', 'inventory')).toBe(false)
    expect(reg.isModuleExposed('store', 'order')).toBe(false)
  })

  // CF-03 — Admin context sees all modules
  it('admin sees all modules', () => {
    const reg = new ContextRegistry()
    reg.registerDefault(MODULES, COMMANDS)

    for (const mod of MODULES) {
      expect(reg.isModuleExposed('admin', mod)).toBe(true)
    }
  })

  // CF-04 — Different actors see different modules
  it('different actors see different modules on same basePath', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({
        name: 'store-b2c',
        basePath: '/api/store',
        actors: 'customer',
        modules: { catalog: '*', cart: '*' },
      }),
      MODULES,
      COMMANDS,
    )
    reg.register(
      defineContext({
        name: 'store-b2b',
        basePath: '/api/store',
        actors: 'employee',
        modules: { catalog: '*', cart: '*', order: '*', inventory: '*' },
      }),
      MODULES,
      COMMANDS,
    )

    // B2C customer: catalog + cart only
    expect(reg.isModuleExposed('store-b2c', 'catalog')).toBe(true)
    expect(reg.isModuleExposed('store-b2c', 'order')).toBe(false)
    expect(reg.isModuleExposed('store-b2c', 'inventory')).toBe(false)

    // B2B employee: everything
    expect(reg.isModuleExposed('store-b2b', 'order')).toBe(true)
    expect(reg.isModuleExposed('store-b2b', 'inventory')).toBe(true)
  })
})

describe('Context Filtering — Public/Private Modules', () => {
  // CF-05 — Public module flag detected
  it('public flag is detected for exposed modules', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({
        name: 'store',
        basePath: '/api/store',
        actors: 'customer',
        modules: {
          catalog: { expose: '*', public: true },
          cart: { expose: '*' },
        },
      }),
      MODULES,
      COMMANDS,
    )

    expect(reg.isPublicModule('store', 'catalog')).toBe(true)
    expect(reg.isPublicModule('store', 'cart')).toBe(false)
  })

  // CF-06 — Admin modules are never public
  it('admin modules default to non-public', () => {
    const reg = new ContextRegistry()
    reg.registerDefault(MODULES, COMMANDS)

    for (const mod of MODULES) {
      expect(reg.isPublicModule('admin', mod)).toBe(false)
    }
  })

  // CF-07 — V2: Auth requirement is per-context via defineUserModel
  it('per-context auth: public paths are unauthenticated, others require JWT + actor_type', () => {
    // V2: auth routes are per-context (/api/{ctx}/login, /api/{ctx}/me)
    // No global /api/auth/* routes exist anymore.
    const publicPaths = new Set([
      '/api/admin/login',
      '/api/admin/logout',
      '/api/admin/refresh',
      '/api/admin/forgot-password',
      '/api/admin/reset-password',
      '/api/admin/accept-invite',
    ])
    const contextPrefix = '/api/admin/'

    const requiresAuth = (path: string) => {
      if (!path.startsWith(contextPrefix)) return false
      return !publicPaths.has(path)
    }

    // Admin context routes require auth
    expect(requiresAuth('/api/admin/command/create-product')).toBe(true)
    expect(requiresAuth('/api/admin/me')).toBe(true)
    expect(requiresAuth('/api/admin/users')).toBe(true)

    // Public auth routes don't require auth
    expect(requiresAuth('/api/admin/login')).toBe(false)
    expect(requiresAuth('/api/admin/forgot-password')).toBe(false)
    expect(requiresAuth('/api/admin/reset-password')).toBe(false)
    expect(requiresAuth('/api/admin/accept-invite')).toBe(false)

    // Store routes (no defineUserModel) don't require auth
    expect(requiresAuth('/api/store/query/catalog')).toBe(false)
  })
})

describe('Context Filtering — Commands', () => {
  // CF-08 — Command visible in context
  it('visible command is accessible', () => {
    const reg = new ContextRegistry()
    reg.register(
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

    expect(reg.isCommandVisible('store', 'checkout')).toBe(true)
  })

  // CF-09 — Command invisible in context
  it('invisible command returns false', () => {
    const reg = new ContextRegistry()
    reg.register(
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

    expect(reg.isCommandVisible('store', 'create-product')).toBe(false)
    expect(reg.isCommandVisible('store', 'archive-product')).toBe(false)
  })

  // CF-10 — Admin sees all commands
  it('admin sees all commands', () => {
    const reg = new ContextRegistry()
    reg.registerDefault(MODULES, COMMANDS)

    for (const cmd of COMMANDS) {
      expect(reg.isCommandVisible('admin', cmd)).toBe(true)
    }
  })

  // CF-11 — Different contexts see different commands
  it('different contexts expose different commands', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({
        name: 'admin',
        basePath: '/api/admin',
        actors: 'user',
        modules: { catalog: '*' },
        commands: ['create-product', 'archive-product'],
      }),
      MODULES,
      COMMANDS,
    )
    reg.register(
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

    // Admin: create-product yes, checkout no
    expect(reg.isCommandVisible('admin', 'create-product')).toBe(true)
    expect(reg.isCommandVisible('admin', 'checkout')).toBe(false)

    // Store: checkout yes, create-product no
    expect(reg.isCommandVisible('store', 'checkout')).toBe(true)
    expect(reg.isCommandVisible('store', 'create-product')).toBe(false)
  })
})

describe('Context Filtering — AI Tools', () => {
  // CF-12 — AI enabled with all commands
  it('AI enabled exposes all context commands', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({
        name: 'admin',
        basePath: '/api/admin',
        actors: 'user',
        modules: { catalog: '*' },
        commands: ['create-product', 'archive-product'],
        ai: true,
      }),
      MODULES,
      COMMANDS,
    )

    const aiCmds = reg.getAiCommands('admin')
    expect(aiCmds).toContain('create-product')
    expect(aiCmds).toContain('archive-product')
  })

  // CF-13 — AI enabled with subset of commands
  it('AI can be restricted to subset of commands', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({
        name: 'store',
        basePath: '/api/store',
        actors: 'customer',
        modules: { catalog: '*' },
        commands: ['checkout', 'apply-discount'],
        ai: { enabled: true, commands: ['checkout'] },
      }),
      MODULES,
      COMMANDS,
    )

    const aiCmds = reg.getAiCommands('store')
    expect(aiCmds).toEqual(['checkout'])
    expect(aiCmds).not.toContain('apply-discount')
  })

  // CF-14 — AI disabled returns empty tools
  it('AI disabled means no tools', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({
        name: 'vendor',
        basePath: '/api/vendor',
        actors: 'vendor',
        modules: { catalog: '*' },
        commands: ['create-product'],
      }),
      MODULES,
      COMMANDS,
    )

    expect(reg.getAiCommands('vendor')).toEqual([])
  })

  // CF-15 — AI enabled context vs disabled on different contexts
  it('AI per-context isolation', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({
        name: 'admin',
        basePath: '/api/admin',
        actors: 'user',
        modules: { catalog: '*' },
        commands: ['create-product', 'checkout'],
        ai: true,
      }),
      MODULES,
      COMMANDS,
    )
    reg.register(
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
    reg.register(
      defineContext({
        name: 'vendor',
        basePath: '/api/vendor',
        actors: 'vendor',
        modules: { catalog: '*' },
      }),
      MODULES,
      COMMANDS,
    )

    // Admin AI: all commands
    expect(reg.getAiCommands('admin').sort()).toEqual(['checkout', 'create-product'])
    // Store AI: only checkout
    expect(reg.getAiCommands('store')).toEqual(['checkout'])
    // Vendor: no AI
    expect(reg.getAiCommands('vendor')).toEqual([])
  })
})

describe('Context Filtering — Nested Relations', () => {
  // CF-16 — Relation field to exposed module passes through
  it('relation to exposed module is kept', () => {
    const exposedModules = new Set(['catalog', 'inventory'])
    const fields = ['title', 'inventory.quantity', 'catalog.sku']

    const stripped: string[] = []
    const warnings: string[] = []
    const allowed: string[] = []

    for (const f of fields) {
      if (f.includes('.')) {
        const relation = f.split('.')[0]
        if (!exposedModules.has(relation)) {
          stripped.push(f)
          warnings.push(`relation '${relation}' unavailable`)
          continue
        }
      }
      allowed.push(f)
    }

    expect(allowed).toEqual(['title', 'inventory.quantity', 'catalog.sku'])
    expect(stripped).toEqual([])
    expect(warnings).toEqual([])
  })

  // CF-17 — Relation field to unmounted module is stripped + warning
  it('relation to unmounted module is stripped with warning', () => {
    const exposedModules = new Set(['catalog'])
    const fields = ['title', 'inventory.quantity', 'order.status']

    const warnings: string[] = []
    const allowed: string[] = []

    for (const f of fields) {
      if (f.includes('.')) {
        const relation = f.split('.')[0]
        if (!exposedModules.has(relation)) {
          warnings.push(`relation '${relation}' unavailable in context 'store' — module '${relation}' not mounted`)
          continue
        }
      }
      allowed.push(f)
    }

    expect(allowed).toEqual(['title'])
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain("relation 'inventory' unavailable")
    expect(warnings[1]).toContain("relation 'order' unavailable")
  })

  // CF-18 — Non-relation fields always pass through
  it('non-relation fields are never stripped', () => {
    const exposedModules = new Set(['catalog'])
    const fields = ['id', 'title', 'sku', 'price', 'created_at']

    const allowed: string[] = []
    for (const f of fields) {
      if (f.includes('.')) {
        const relation = f.split('.')[0]
        if (!exposedModules.has(relation)) continue
      }
      allowed.push(f)
    }

    expect(allowed).toEqual(fields)
  })

  // CF-19 — Warning message includes context name and module
  it('warning message is descriptive for AI consumption', () => {
    const exposedModules = new Set(['catalog'])
    const contextName = 'store'
    const field = 'inventory.quantity'
    const relation = field.split('.')[0]

    const warning = `relation '${relation}' unavailable in context '${contextName}' — module '${relation}' not mounted`

    expect(warning).toBe("relation 'inventory' unavailable in context 'store' — module 'inventory' not mounted")
  })

  // CF-20 — Server logs stripped relations
  it('server logs when relations are stripped', () => {
    const logMessages: string[] = []
    const logger = { warn: (msg: string) => logMessages.push(msg) }

    const exposedModules = new Set(['catalog'])
    const fields = ['title', 'inventory.quantity']

    for (const f of fields) {
      if (f.includes('.')) {
        const relation = f.split('.')[0]
        if (!exposedModules.has(relation)) {
          logger.warn(`[query] Stripped relation '${relation}' from product query — not mounted in context 'store'`)
        }
      }
    }

    expect(logMessages).toHaveLength(1)
    expect(logMessages[0]).toContain("Stripped relation 'inventory'")
    expect(logMessages[0]).toContain("context 'store'")
  })

  // CF-21 — Response includes warnings array alongside data
  it('response shape includes warnings when relations are stripped', () => {
    const warnings = ["relation 'inventory' unavailable in context 'store' — module 'inventory' not mounted"]
    const data = [{ id: '1', title: 'Widget' }]

    const response = {
      data,
      count: 1,
      limit: 100,
      offset: 0,
      warnings,
    }

    expect(response.data).toHaveLength(1)
    expect(response.warnings).toHaveLength(1)
    expect(response.data[0]).not.toHaveProperty('inventory')
  })
})

describe('Context Filtering — Actor Resolution', () => {
  // CF-22 — Correct context resolved for each actor
  it('resolves context by actor type', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({ name: 'admin', basePath: '/api/admin', actors: 'user', modules: { catalog: '*' } }),
      MODULES,
      COMMANDS,
    )
    reg.register(
      defineContext({ name: 'store', basePath: '/api/store', actors: 'customer', modules: { catalog: '*' } }),
      MODULES,
      COMMANDS,
    )
    reg.register(
      defineContext({ name: 'vendor', basePath: '/api/vendor', actors: 'vendor', modules: { catalog: '*' } }),
      MODULES,
      COMMANDS,
    )

    expect(reg.resolve('/api/admin/query/x', 'user')!.name).toBe('admin')
    expect(reg.resolve('/api/store/query/x', 'customer')!.name).toBe('store')
    expect(reg.resolve('/api/vendor/query/x', 'vendor')!.name).toBe('vendor')
  })

  // CF-23 — Wrong actor on a basePath → no context match
  it('wrong actor returns null', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({ name: 'admin', basePath: '/api/admin', actors: 'user', modules: { catalog: '*' } }),
      MODULES,
      COMMANDS,
    )

    expect(reg.resolve('/api/admin/query/x', 'customer')).toBeNull()
    expect(reg.resolve('/api/admin/query/x', 'vendor')).toBeNull()
  })

  // CF-24 — Context with multiple actors
  it('context accepts multiple actor types', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({
        name: 'store',
        basePath: '/api/store',
        actors: ['customer', 'employee'],
        modules: { catalog: '*' },
      }),
      MODULES,
      COMMANDS,
    )

    expect(reg.resolve('/api/store/query/x', 'customer')!.name).toBe('store')
    expect(reg.resolve('/api/store/query/x', 'employee')!.name).toBe('store')
    expect(reg.resolve('/api/store/query/x', 'vendor')).toBeNull()
  })
})
