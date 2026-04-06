// CMD-01 → CMD-12 — CQRS defineCommand + CommandRegistry tests

import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { InMemoryCacheAdapter } from '../../src/adapters/cache-memory'
import { InMemoryEventBusAdapter } from '../../src/adapters/eventbus-memory'
import { InMemoryFileAdapter } from '../../src/adapters/file-memory'
import { InMemoryLockingAdapter } from '../../src/adapters/locking-memory'
import { TestLogger } from '../../src/adapters/logger-test'
import { createTestMantaApp } from '../../src/app'
import { CommandRegistry, defineCommand, QUERY_TOOL_SCHEMA, zodToJsonSchema } from '../../src/command'
import { MantaError } from '../../src/errors/manta-error'

describe('defineCommand + CommandRegistry', () => {
  let registry: CommandRegistry

  beforeEach(() => {
    registry = new CommandRegistry()
  })

  // CMD-01
  it('defineCommand() returns a valid CommandDefinition', () => {
    const cmd = defineCommand({
      name: 'create-product',
      description: 'Creates a product',
      input: z.object({ title: z.string() }),
      workflow: async (input) => ({ id: '1', title: input.title }),
    })

    expect(cmd.name).toBe('create-product')
    expect(cmd.description).toBe('Creates a product')
    expect(cmd.input).toBeDefined()
    expect(typeof cmd.workflow).toBe('function')
  })

  // CMD-02
  it('defineCommand() throws on missing name/description/input/workflow', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    expect(() =>
      defineCommand({ name: '', description: 'x', input: z.object({}), workflow: async () => {} } as any),
    ).toThrow(MantaError)

    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    expect(() =>
      defineCommand({ name: 'x', description: '', input: z.object({}), workflow: async () => {} } as any),
    ).toThrow(MantaError)

    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    expect(() => defineCommand({ name: 'x', description: 'x', input: null, workflow: async () => {} } as any)).toThrow(
      MantaError,
    )

    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    expect(() =>
      defineCommand({ name: 'x', description: 'x', input: z.object({}), workflow: 'not a fn' } as any),
    ).toThrow(MantaError)
  })

  // CMD-03
  it('CommandRegistry.register() stores and retrieves', () => {
    const cmd = defineCommand({
      name: 'delete-product',
      description: 'Deletes a product',
      input: z.object({ id: z.string() }),
      workflow: async () => ({ deleted: true }),
    })

    registry.register(cmd)
    const entry = registry.get('delete-product')
    expect(entry).toBeDefined()
    expect(entry!.name).toBe('delete-product')
    expect(entry!.description).toBe('Deletes a product')
  })

  // CMD-04
  it('CommandRegistry.register() throws on duplicate', () => {
    const cmd = defineCommand({
      name: 'dupe',
      description: 'First',
      input: z.object({}),
      workflow: async () => ({}),
    })

    registry.register(cmd)
    expect(() => registry.register(cmd)).toThrow(MantaError)
  })

  // CMD-05
  it('CommandRegistry.list() returns all commands', () => {
    registry.register(
      defineCommand({
        name: 'cmd-a',
        description: 'A',
        input: z.object({}),
        workflow: async () => ({}),
      }),
    )
    registry.register(
      defineCommand({
        name: 'cmd-b',
        description: 'B',
        input: z.object({}),
        workflow: async () => ({}),
      }),
    )

    const all = registry.list()
    expect(all).toHaveLength(2)
    expect(all.map((e) => e.name)).toContain('cmd-a')
    expect(all.map((e) => e.name)).toContain('cmd-b')
  })

  // CMD-06
  it('CommandRegistry.toToolSchemas() generates valid JSON Schemas', () => {
    registry.register(
      defineCommand({
        name: 'create-item',
        description: 'Create an item',
        input: z.object({ title: z.string(), count: z.number() }),
        workflow: async () => ({}),
      }),
    )

    const schemas = registry.toToolSchemas()
    // First is always query
    expect(schemas[0].name).toBe('query')
    // Second is our command
    expect(schemas[1].name).toBe('create-item')
    expect(schemas[1].description).toBe('Create an item')
    expect(schemas[1].input_schema).toEqual({
      type: 'object',
      properties: {
        title: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['title', 'count'],
    })
  })

  // CMD-07
  it('zodToJsonSchema() handles string/number/boolean/array/enum/optional', () => {
    expect(zodToJsonSchema(z.string())).toEqual({ type: 'string' })
    expect(zodToJsonSchema(z.number())).toEqual({ type: 'number' })
    expect(zodToJsonSchema(z.boolean())).toEqual({ type: 'boolean' })
    expect(zodToJsonSchema(z.array(z.string()))).toEqual({ type: 'array', items: { type: 'string' } })
    expect(zodToJsonSchema(z.enum(['a', 'b']))).toEqual({ type: 'string', enum: ['a', 'b'] })

    // Optional — unwraps
    const optSchema = zodToJsonSchema(z.object({ name: z.string(), age: z.number().optional() }))
    expect(optSchema).toEqual({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'number' } },
      required: ['name'],
    })

    // Default
    const defSchema = zodToJsonSchema(z.object({ color: z.string().default('red') }))
    expect(defSchema).toEqual({
      type: 'object',
      properties: { color: { type: 'string', default: 'red' } },
    })
  })

  // CMD-08
  it('Command callable: valid input executes workflow', async () => {
    const cmd = defineCommand({
      name: 'test-cmd',
      description: 'Test',
      input: z.object({ value: z.number() }),
      workflow: async (input) => ({ doubled: input.value * 2 }),
    })

    // Simulate what bootstrap does: parse + execute
    const parsed = cmd.input.parse({ value: 5 })
    const result = await cmd.workflow(parsed, {} as never)
    expect(result).toEqual({ doubled: 10 })
  })

  // CMD-09
  it('Command callable: invalid input throws ZodError', () => {
    const cmd = defineCommand({
      name: 'test-cmd',
      description: 'Test',
      input: z.object({ value: z.number() }),
      workflow: async (input) => ({ doubled: input.value * 2 }),
    })

    expect(() => cmd.input.parse({ value: 'not a number' })).toThrow()
  })

  // CMD-10
  it('app.commands.testCmd is accessible via TestMantaApp', async () => {
    const app = createTestMantaApp({
      infra: {
        eventBus: new InMemoryEventBusAdapter(),
        logger: new TestLogger(),
        cache: new InMemoryCacheAdapter(),
        locking: new InMemoryLockingAdapter(),
        file: new InMemoryFileAdapter(),
        db: null,
      },
    })

    app.registerCommand('deleteProduct', async (input) => {
      const { id } = input as { id: string }
      return { deleted: id }
    })

    const result = await app.commands.deleteProduct({ id: 'p-123' })
    expect(result).toEqual({ deleted: 'p-123' })
  })

  // CMD-11
  it('QUERY_TOOL_SCHEMA is a valid JSON Schema', () => {
    expect(QUERY_TOOL_SCHEMA.name).toBe('query')
    expect(QUERY_TOOL_SCHEMA.description).toBeTruthy()
    expect(QUERY_TOOL_SCHEMA.input_schema.type).toBe('object')
    expect(QUERY_TOOL_SCHEMA.input_schema.required).toEqual(['entity'])
    expect(QUERY_TOOL_SCHEMA.input_schema.properties).toBeDefined()
  })

  // CMD-12
  it('_reset() clears the registry', () => {
    registry.register(
      defineCommand({
        name: 'to-clear',
        description: 'Will be cleared',
        input: z.object({}),
        workflow: async () => ({}),
      }),
    )

    expect(registry.list()).toHaveLength(1)
    registry._reset()
    expect(registry.list()).toHaveLength(0)
  })
})
