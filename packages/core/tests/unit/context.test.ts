import { ContextRegistry } from '@manta/core'
import { describe, expect, it } from 'vitest'
import { defineContext } from '../../src/context'

describe('defineContext()', () => {
  // CX-01 — returns config
  it('returns the config object', () => {
    const ctx = defineContext({
      name: 'store',
      basePath: '/api/store',
      actors: ['customer'],
      modules: { catalog: '*' },
    })
    expect(ctx.name).toBe('store')
    expect(ctx.basePath).toBe('/api/store')
  })

  // CX-02 — validates required fields
  it('throws on missing name', () => {
    expect(() => defineContext({ name: '', basePath: '/api/x', actors: ['a'], modules: {} })).toThrow(
      'name is required',
    )
  })

  it('throws on missing basePath', () => {
    expect(() => defineContext({ name: 'x', basePath: '', actors: ['a'], modules: {} })).toThrow('basePath is required')
  })

  it('throws on empty actors', () => {
    expect(() => defineContext({ name: 'x', basePath: '/api/x', actors: [], modules: {} })).toThrow(
      'actors must be a non-empty',
    )
  })
})

describe('ContextRegistry', () => {
  const modules = ['catalog', 'cart', 'order']
  const commands = ['checkout', 'create-product', 'apply-discount']

  // CX-03 — register and list
  it('registers and lists contexts', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({
        name: 'admin',
        basePath: '/api/admin',
        actors: 'user',
        modules: { catalog: '*' },
        commands: ['create-product'],
      }),
      modules,
      commands,
    )
    expect(reg.list()).toHaveLength(1)
    expect(reg.get('admin')!.name).toBe('admin')
  })

  // CX-04 — rejects duplicate basePath + same actor
  it('throws on duplicate basePath + actor', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({ name: 'store', basePath: '/api/store', actors: 'customer', modules: { catalog: '*' } }),
      modules,
      commands,
    )
    expect(() =>
      reg.register(
        defineContext({ name: 'store2', basePath: '/api/store', actors: 'customer', modules: { cart: '*' } }),
        modules,
        commands,
      ),
    ).toThrow('conflicts')
  })

  // CX-05 — same basePath + different actors allowed
  it('allows same basePath with different actors', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({ name: 'store-b2c', basePath: '/api/store', actors: 'customer', modules: { catalog: '*' } }),
      modules,
      commands,
    )
    reg.register(
      defineContext({ name: 'store-b2b', basePath: '/api/store', actors: 'employee', modules: { catalog: '*' } }),
      modules,
      commands,
    )
    expect(reg.list()).toHaveLength(2)
  })

  // CX-06 — resolve by pathname + actor
  it('resolves context by pathname + actor', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({ name: 'store', basePath: '/api/store', actors: 'customer', modules: { catalog: '*' } }),
      modules,
      commands,
    )
    reg.register(
      defineContext({ name: 'admin', basePath: '/api/admin', actors: 'user', modules: { catalog: '*' } }),
      modules,
      commands,
    )

    expect(reg.resolve('/api/store/query/catalog', 'customer')!.name).toBe('store')
    expect(reg.resolve('/api/admin/command/x', 'user')!.name).toBe('admin')
  })

  // CX-07 — resolve returns null for unknown path
  it('resolves null for unknown path', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({ name: 'store', basePath: '/api/store', actors: 'customer', modules: { catalog: '*' } }),
      modules,
      commands,
    )
    expect(reg.resolve('/api/vendor/query', 'vendor')).toBeNull()
  })

  // CX-08 — isModuleExposed returns false for unmounted module
  it('isModuleExposed returns false for unmounted module', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({ name: 'store', basePath: '/api/store', actors: 'customer', modules: { catalog: '*' } }),
      modules,
      commands,
    )
    expect(reg.isModuleExposed('store', 'catalog')).toBe(true)
    expect(reg.isModuleExposed('store', 'order')).toBe(false)
  })

  // CX-09 — isCommandVisible returns false for unregistered command
  it('isCommandVisible returns false for unregistered command', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({
        name: 'store',
        basePath: '/api/store',
        actors: 'customer',
        modules: { catalog: '*' },
        commands: ['checkout'],
      }),
      modules,
      commands,
    )
    expect(reg.isCommandVisible('store', 'checkout')).toBe(true)
    expect(reg.isCommandVisible('store', 'create-product')).toBe(false)
  })

  // CX-10 — isPublicModule
  it('public modules are detected', () => {
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
      modules,
      commands,
    )
    expect(reg.isPublicModule('store', 'catalog')).toBe(true)
    expect(reg.isPublicModule('store', 'cart')).toBe(false)
  })

  // CX-11 — boot error if module doesn't exist
  it('throws if module not in available list', () => {
    const reg = new ContextRegistry()
    expect(() =>
      reg.register(
        defineContext({ name: 'x', basePath: '/api/x', actors: 'a', modules: { nonexistent: '*' } }),
        modules,
        commands,
      ),
    ).toThrow('module "nonexistent" not found')
  })

  // CX-12 — boot error if command doesn't exist
  it('throws if command not in available list', () => {
    const reg = new ContextRegistry()
    expect(() =>
      reg.register(
        defineContext({
          name: 'x',
          basePath: '/api/x',
          actors: 'a',
          modules: { catalog: '*' },
          commands: ['nonexistent'],
        }),
        modules,
        commands,
      ),
    ).toThrow('command "nonexistent" not found')
  })

  // CX-13 — registerDefault creates admin context with all modules/commands
  it('registerDefault creates admin with all modules and commands', () => {
    const reg = new ContextRegistry()
    reg.registerDefault(modules, commands)

    const admin = reg.get('admin')!
    expect(admin.basePath).toBe('/api/admin')
    expect(admin.actors).toEqual(['user'])
    expect([...admin.modules.keys()]).toEqual(modules)
    expect([...admin.commands]).toEqual(commands)
    expect(admin.ai.enabled).toBe(true)
  })

  // CX-14 — AI commands filtered by context
  it('getAiCommands returns filtered commands', () => {
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
      modules,
      commands,
    )
    expect(reg.getAiCommands('store')).toEqual(['checkout'])
  })

  // CX-15 — AI disabled returns empty commands
  it('getAiCommands returns empty when AI disabled', () => {
    const reg = new ContextRegistry()
    reg.register(
      defineContext({
        name: 'vendor',
        basePath: '/api/vendor',
        actors: 'vendor',
        modules: { catalog: '*' },
      }),
      modules,
      commands,
    )
    expect(reg.getAiCommands('vendor')).toEqual([])
  })
})
