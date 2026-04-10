// CG-01 → CG-12 — defineCommandGraph, dmlToZod, generateEntityCommands tests

import { describe, expect, it } from 'vitest'
import type { CommandAccessRule } from '../../src/command/define-command-graph'
import {
  defineCommandGraph,
  getCommandScope,
  isCommandAllowed,
  isModuleAllowed,
} from '../../src/command/define-command-graph'
import { dmlToZod } from '../../src/command/dml-to-zod'
import {
  generateEntityCommands,
  generateLinkCommands,
  generateModuleCommands,
} from '../../src/command/generate-entity-commands'
// Import DML — must import the barrel to trigger NullableModifier/ComputedProperty registration side effects
import '../../src/dml/properties/nullable'
import '../../src/dml/properties/computed'
import { defineModel, field } from '../../src/dml/model'

// Helper: defineCommandGraph's typed overload expects `Record<ModuleNameArg, ...>` which, with
// codegen-populated MantaGeneratedAppModules, becomes an intersection that requires all registered
// module keys. Tests use arbitrary module names, so we cast through `any` to bypass the constraint.
// biome-ignore lint/suspicious/noExplicitAny: test helper to bypass codegen-augmented module keys
const access = (map: Record<string, CommandAccessRule>): any => map

// ── defineCommandGraph ──────────────────────────────────────────────

describe('defineCommandGraph', () => {
  // CG-01
  it('creates a wildcard command graph', () => {
    const graph = defineCommandGraph('*')
    expect(graph.__type).toBe('command-graph')
    expect(graph.access).toBe('*')
  })

  // CG-02
  it('creates a filtered command graph with per-module rules', () => {
    const graph = defineCommandGraph(
      access({
        catalog: true,
        customer: ['create', 'update'],
      }),
    )
    expect(graph.__type).toBe('command-graph')
    expect(graph.access).toEqual({
      catalog: true,
      customer: ['create', 'update'],
    })
  })

  // CG-03
  it('throws on empty module map', () => {
    expect(() => defineCommandGraph({} as '*')).toThrow('cannot be empty')
  })

  // CG-04
  it('throws on invalid access type', () => {
    expect(() => defineCommandGraph(123 as unknown as '*')).toThrow('requires "*" or a module access map')
  })
})

describe('isModuleAllowed', () => {
  // CG-05
  it('wildcard allows all modules', () => {
    const graph = defineCommandGraph('*')
    expect(isModuleAllowed(graph, 'catalog')).toBe(true)
    expect(isModuleAllowed(graph, 'anything')).toBe(true)
  })

  // CG-06
  it('filtered graph allows only listed modules', () => {
    const graph = defineCommandGraph(access({ catalog: true, customer: ['create'] }))
    expect(isModuleAllowed(graph, 'catalog')).toBe(true)
    expect(isModuleAllowed(graph, 'customer')).toBe(true)
    expect(isModuleAllowed(graph, 'stats')).toBe(false)
  })
})

describe('isCommandAllowed', () => {
  // CG-07
  it('wildcard allows all commands', () => {
    const graph = defineCommandGraph('*')
    expect(isCommandAllowed(graph, 'catalog', 'create')).toBe(true)
    expect(isCommandAllowed(graph, 'catalog', 'delete')).toBe(true)
  })

  // CG-08
  it('true rule allows all operations', () => {
    const graph = defineCommandGraph(access({ catalog: true }))
    expect(isCommandAllowed(graph, 'catalog', 'create')).toBe(true)
    expect(isCommandAllowed(graph, 'catalog', 'custom-method')).toBe(true)
  })

  // CG-09
  it('array rule allows only listed operations', () => {
    const graph = defineCommandGraph(access({ customer: ['create', 'update'] }))
    expect(isCommandAllowed(graph, 'customer', 'create')).toBe(true)
    expect(isCommandAllowed(graph, 'customer', 'update')).toBe(true)
    expect(isCommandAllowed(graph, 'customer', 'delete')).toBe(false)
  })

  // CG-10
  it('function rule allows all operations (scope is for data filtering)', () => {
    const graph = defineCommandGraph(
      access({
        order: (auth) => ({ customer_id: auth.id }),
      }),
    )
    expect(isCommandAllowed(graph, 'order', 'create')).toBe(true)
    expect(isCommandAllowed(graph, 'order', 'delete')).toBe(true)
  })

  // CG-11
  it('unlisted module blocks all operations', () => {
    const graph = defineCommandGraph(access({ catalog: true }))
    expect(isCommandAllowed(graph, 'stats', 'create')).toBe(false)
  })
})

describe('getCommandScope', () => {
  it('wildcard returns undefined (no scope)', () => {
    const graph = defineCommandGraph('*')
    expect(getCommandScope(graph, 'catalog', null)).toBeUndefined()
  })

  it('true rule returns undefined (no scope)', () => {
    const graph = defineCommandGraph(access({ catalog: true }))
    expect(getCommandScope(graph, 'catalog', null)).toBeUndefined()
  })

  it('array rule returns undefined (no scope)', () => {
    const graph = defineCommandGraph(access({ catalog: ['create'] }))
    expect(getCommandScope(graph, 'catalog', null)).toBeUndefined()
  })

  it('function rule returns scope from auth', () => {
    const graph = defineCommandGraph(
      access({
        order: (auth) => ({ customer_id: auth.id }),
      }),
    )
    const scope = getCommandScope(graph, 'order', { id: 'user-1', type: 'customer' })
    expect(scope).toEqual({ customer_id: 'user-1' })
  })

  it('function rule returns null when no auth', () => {
    const graph = defineCommandGraph(
      access({
        order: (auth) => ({ customer_id: auth.id }),
      }),
    )
    expect(getCommandScope(graph, 'order', null)).toBeNull()
  })

  it('unlisted module returns null', () => {
    const graph = defineCommandGraph(access({ catalog: true }))
    expect(getCommandScope(graph, 'stats', null)).toBeNull()
  })
})

// ── dmlToZod ──────────────────────────────────────────────────────

describe('dmlToZod', () => {
  const Product = defineModel('Product', {
    title: field.text(),
    price: field.number(),
    status: field.enum(['draft', 'active', 'archived']),
    description: field.text().nullable(),
    is_featured: field.boolean().default(false),
  })

  it('generates create schema with required and optional fields', () => {
    const schemas = dmlToZod(Product)
    const shape = schemas.create.shape

    // Required fields
    expect(shape.title).toBeDefined()
    expect(shape.price).toBeDefined()
    expect(shape.status).toBeDefined()

    // Optional fields (nullable or has default)
    expect(shape.description).toBeDefined()
    expect(shape.is_featured).toBeDefined()

    // Implicit fields excluded
    expect(shape.id).toBeUndefined()
    expect(shape.created_at).toBeUndefined()
    expect(shape.updated_at).toBeUndefined()
    expect(shape.deleted_at).toBeUndefined()
  })

  it('create schema validates correctly', () => {
    const schemas = dmlToZod(Product)

    // Valid input
    const valid = schemas.create.parse({
      title: 'Widget',
      price: 100,
      status: 'draft',
    })
    expect(valid.title).toBe('Widget')
    expect(valid.price).toBe(100)

    // Missing required field
    expect(() => schemas.create.parse({ title: 'Widget' })).toThrow()
  })

  it('generates update schema with all fields optional + required id', () => {
    const schemas = dmlToZod(Product)
    const shape = schemas.update.shape

    expect(shape.id).toBeDefined()
    // All fields optional
    const valid = schemas.update.parse({ id: '123', title: 'Updated' })
    expect(valid.id).toBe('123')
    expect(valid.title).toBe('Updated')
  })

  it('generates delete schema with just id', () => {
    const schemas = dmlToZod(Product)
    const valid = schemas.delete.parse({ id: '123' })
    expect(valid.id).toBe('123')
  })

  it('generates list schema with filters and pagination', () => {
    const schemas = dmlToZod(Product)
    const valid = schemas.list.parse({
      filters: { status: 'active' },
      limit: 20,
      offset: 0,
    })
    expect(valid.filters).toEqual({ status: 'active' })
    expect(valid.limit).toBe(20)
  })

  it('handles enum fields correctly', () => {
    const schemas = dmlToZod(Product)
    // Enum should accept valid values
    const valid = schemas.create.parse({
      title: 'Widget',
      price: 100,
      status: 'draft',
    })
    expect(valid.status).toBe('draft')

    // Enum should reject invalid values
    expect(() =>
      schemas.create.parse({
        title: 'Widget',
        price: 100,
        status: 'invalid',
      }),
    ).toThrow()
  })
})

// ── generateEntityCommands ──────────────────────────────────────────

describe('generateEntityCommands', () => {
  const Product = defineModel('Product', {
    title: field.text(),
    price: field.number(),
    status: field.enum(['draft', 'active', 'archived']),
    description: field.text().nullable(),
  })

  it('generates 5 commands for an entity', () => {
    const commands = generateEntityCommands('catalog', Product)
    expect(commands).toHaveLength(5)

    const names = commands.map((c) => c.name)
    expect(names).toContain('createProduct')
    expect(names).toContain('updateProduct')
    expect(names).toContain('deleteProduct')
    expect(names).toContain('retrieveProduct')
    expect(names).toContain('listProducts')
  })

  it('all commands are marked as auto-generated', () => {
    const commands = generateEntityCommands('catalog', Product)
    for (const cmd of commands) {
      expect(cmd.__autoGenerated).toBe(true)
      expect(cmd.__module).toBe('catalog')
      expect(cmd.__entity).toBe('Product')
      expect(cmd.__type).toBe('command')
    }
  })

  it('each command has the correct operation type', () => {
    const commands = generateEntityCommands('catalog', Product)
    const byOp = Object.fromEntries(commands.map((c) => [c.__operation, c]))
    expect(byOp.create).toBeDefined()
    expect(byOp.update).toBeDefined()
    expect(byOp.delete).toBeDefined()
    expect(byOp.retrieve).toBeDefined()
    expect(byOp.list).toBeDefined()
  })

  it('create command validates input from DML schema', () => {
    const commands = generateEntityCommands('catalog', Product)
    const createCmd = commands.find((c) => c.__operation === 'create')!

    // Valid input
    const valid = createCmd.input.parse({
      title: 'Widget',
      price: 100,
      status: 'draft',
    }) as Record<string, unknown>
    expect(valid.title).toBe('Widget')

    // Missing required field
    expect(() => createCmd.input.parse({ title: 'Widget' })).toThrow()
  })

  it('update command requires id, all other fields optional', () => {
    const commands = generateEntityCommands('catalog', Product)
    const updateCmd = commands.find((c) => c.__operation === 'update')!

    // Valid with just id + partial fields
    const valid = updateCmd.input.parse({ id: '123', title: 'Updated' }) as Record<string, unknown>
    expect(valid.id).toBe('123')

    // Missing id
    expect(() => updateCmd.input.parse({ title: 'Updated' })).toThrow()
  })

  it('each command has a description', () => {
    const commands = generateEntityCommands('catalog', Product)
    for (const cmd of commands) {
      expect(cmd.description).toBeTruthy()
      expect(typeof cmd.description).toBe('string')
    }
  })
})

describe('generateModuleCommands', () => {
  const Product = defineModel('Product', {
    title: field.text(),
    price: field.number(),
  })
  const Category = defineModel('Category', {
    name: field.text(),
  })

  it('generates commands for all entities in a module', () => {
    const commands = generateModuleCommands('catalog', { Product, Category })
    expect(commands.length).toBe(10) // 5 per entity × 2 entities

    const productCmds = commands.filter((c) => c.__entity === 'Product')
    const categoryCmds = commands.filter((c) => c.__entity === 'Category')
    expect(productCmds).toHaveLength(5)
    expect(categoryCmds).toHaveLength(5)
  })
})

// ── generateLinkCommands ────────────────────────────────────────

describe('generateLinkCommands', () => {
  const link = {
    __type: 'link' as const,
    leftEntity: 'Customer',
    rightEntity: 'CustomerGroup',
    tableName: 'customer_customer_group',
    leftFk: 'customer_id',
    rightFk: 'customer_group_id',
    cardinality: 'M:N' as const,
    cascadeLeft: false,
    cascadeRight: false,
  }

  it('generates 2 commands (link + unlink) for a link definition', () => {
    const commands = generateLinkCommands(link)
    expect(commands).toHaveLength(2)

    const names = commands.map((c) => c.name)
    expect(names).toContain('linkCustomerCustomerGroup')
    expect(names).toContain('unlinkCustomerCustomerGroup')
  })

  it('link command has correct operation type', () => {
    const commands = generateLinkCommands(link)
    const linkCmd = commands.find((c) => c.__operation === 'link')!
    expect(linkCmd).toBeDefined()
    expect(linkCmd.__autoGenerated).toBe(true)
    expect(linkCmd.__type).toBe('command')
  })

  it('unlink command has correct operation type', () => {
    const commands = generateLinkCommands(link)
    const unlinkCmd = commands.find((c) => c.__operation === 'unlink')!
    expect(unlinkCmd).toBeDefined()
    expect(unlinkCmd.__autoGenerated).toBe(true)
  })

  it('input schema requires both entity IDs', () => {
    const commands = generateLinkCommands(link)
    const linkCmd = commands.find((c) => c.__operation === 'link')!

    // Valid input
    const valid = linkCmd.input.parse({ customer_id: 'abc', customer_group_id: 'def' }) as Record<string, unknown>
    expect(valid.customer_id).toBe('abc')
    expect(valid.customer_group_id).toBe('def')

    // Missing one ID
    expect(() => linkCmd.input.parse({ customer_id: 'abc' })).toThrow()
    expect(() => linkCmd.input.parse({ customer_group_id: 'def' })).toThrow()
    expect(() => linkCmd.input.parse({})).toThrow()
  })

  it('commands have descriptions', () => {
    const commands = generateLinkCommands(link)
    for (const cmd of commands) {
      expect(cmd.description).toBeTruthy()
      expect(cmd.description).toContain('customer')
    }
  })

  it('works with different entity name formats', () => {
    const link2 = {
      ...link,
      leftEntity: 'Product',
      rightEntity: 'InventoryItem',
      tableName: 'product_inventory_item',
      leftFk: 'product_id',
      rightFk: 'inventory_item_id',
    }
    const commands = generateLinkCommands(link2)
    const names = commands.map((c) => c.name)
    expect(names).toContain('linkProductInventoryItem')
    expect(names).toContain('unlinkProductInventoryItem')
  })

  // ── extraColumns support ────────────────────────────────────

  // Helper: DML-like field mock with .parse()
  function mockField(dataType: string, opts?: { nullable?: boolean; defaultValue?: unknown }) {
    return {
      parse: (fieldName: string) => ({
        fieldName,
        dataType: { name: dataType },
        nullable: opts?.nullable ?? false,
        primaryKey: false,
        computed: false,
        defaultValue: opts?.defaultValue,
      }),
    }
  }

  it('CG-EC-01 — extraColumns fields are included in the input Zod schema', () => {
    const linkWithExtras = {
      ...link,
      extraColumns: {
        quantity: mockField('number'),
        sku: mockField('text'),
      },
    }
    const commands = generateLinkCommands(linkWithExtras)
    const linkCmd = commands.find((c) => c.__operation === 'link')!

    // Valid input includes extra columns
    const valid = linkCmd.input.parse({
      customer_id: 'c1',
      customer_group_id: 'g1',
      quantity: 42,
      sku: 'SKU-001',
    }) as Record<string, unknown>
    expect(valid.quantity).toBe(42)
    expect(valid.sku).toBe('SKU-001')
  })

  it('CG-EC-02 — nullable extraColumn is optional in the Zod schema', () => {
    const linkWithExtras = {
      ...link,
      extraColumns: {
        notes: mockField('text', { nullable: true }),
      },
    }
    const commands = generateLinkCommands(linkWithExtras)
    const linkCmd = commands.find((c) => c.__operation === 'link')!

    // Should pass without notes (it is optional)
    const valid = linkCmd.input.parse({
      customer_id: 'c1',
      customer_group_id: 'g1',
    }) as Record<string, unknown>
    expect(valid.customer_id).toBe('c1')
    expect(valid.notes).toBeUndefined()
  })

  it('CG-EC-03 — extraColumn with defaultValue is optional in the Zod schema', () => {
    const linkWithExtras = {
      ...link,
      extraColumns: {
        position: mockField('number', { defaultValue: 0 }),
      },
    }
    const commands = generateLinkCommands(linkWithExtras)
    const linkCmd = commands.find((c) => c.__operation === 'link')!

    // Should pass without position (it has a default)
    const valid = linkCmd.input.parse({
      customer_id: 'c1',
      customer_group_id: 'g1',
    }) as Record<string, unknown>
    expect(valid.customer_id).toBe('c1')
    expect(valid.position).toBeUndefined()
  })

  it('CG-EC-04 — required extraColumn rejects input when missing', () => {
    const linkWithExtras = {
      ...link,
      extraColumns: {
        quantity: mockField('number'), // not nullable, no default → required
      },
    }
    const commands = generateLinkCommands(linkWithExtras)
    const linkCmd = commands.find((c) => c.__operation === 'link')!

    // Missing required extra column should throw
    expect(() =>
      linkCmd.input.parse({
        customer_id: 'c1',
        customer_group_id: 'g1',
      }),
    ).toThrow()
  })

  it('CG-EC-05 — boolean extraColumn maps to z.boolean()', () => {
    const linkWithExtras = {
      ...link,
      extraColumns: {
        is_primary: mockField('boolean'),
      },
    }
    const commands = generateLinkCommands(linkWithExtras)
    const linkCmd = commands.find((c) => c.__operation === 'link')!

    // String should be rejected for boolean field
    expect(() =>
      linkCmd.input.parse({
        customer_id: 'c1',
        customer_group_id: 'g1',
        is_primary: 'not-a-bool',
      }),
    ).toThrow()

    // Boolean should pass
    const valid = linkCmd.input.parse({
      customer_id: 'c1',
      customer_group_id: 'g1',
      is_primary: true,
    }) as Record<string, unknown>
    expect(valid.is_primary).toBe(true)
  })

  it('CG-EC-06 — unlink command also gets the extraColumns in its schema', () => {
    const linkWithExtras = {
      ...link,
      extraColumns: {
        quantity: mockField('number'),
      },
    }
    const commands = generateLinkCommands(linkWithExtras)
    const unlinkCmd = commands.find((c) => c.__operation === 'unlink')!

    // Unlink shares the same input schema
    const valid = unlinkCmd.input.parse({
      customer_id: 'c1',
      customer_group_id: 'g1',
      quantity: 10,
    }) as Record<string, unknown>
    expect(valid.quantity).toBe(10)
  })

  it('CG-EC-07 — json/array extraColumn maps to z.unknown()', () => {
    const linkWithExtras = {
      ...link,
      extraColumns: {
        metadata: mockField('json', { nullable: true }),
      },
    }
    const commands = generateLinkCommands(linkWithExtras)
    const linkCmd = commands.find((c) => c.__operation === 'link')!

    // Any value should be accepted for z.unknown()
    const valid = linkCmd.input.parse({
      customer_id: 'c1',
      customer_group_id: 'g1',
      metadata: { foo: 'bar' },
    }) as Record<string, unknown>
    expect(valid.metadata).toEqual({ foo: 'bar' })
  })
})
