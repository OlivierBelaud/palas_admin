// CQRS Tool-First — defineCommand() + CommandRegistry
// Pure domain, zero infra dependency.

import type { z } from 'zod'
import type { DmlEntity } from '../dml/entity'
import { MantaError } from '../errors/manta-error'
import type { ActionStepConfig } from '../workflows/step'
import { step as stepApi } from '../workflows/step'
import type { StepContext } from '../workflows/types'
import type { CommandDefinition, CommandToolSchema, TypedCommandConfig } from './types'

// ── Typed step proxy (pre-bound to ctx) ──────────────────────────────

/**
 * Shared state across all module proxies in a workflow.
 * Tracks the last created entity ID per entity type.
 * step.product.create() stores Product ID → step.product.link.inventoryItem() reads it.
 */
type EntityIdMap = Map<string, string[]>

function createBoundModuleProxy(moduleName: string, ctx: StepContext, ids: EntityIdMap): Record<string, unknown> {
  // Resolve the DML entity name from the service (e.g. module "catalog" → entity "Product")
  // The CRUD methods use the entity name, not the module name.
  let entity = moduleName.charAt(0).toUpperCase() + moduleName.slice(1)
  try {
    const modules = ctx.app.modules as Record<string, unknown>
    const service = modules[moduleName] as Record<string, unknown> | undefined
    if (service?.__entity) {
      entity = (service.__entity as { name: string }).name
    }
  } catch {
    /* fallback to capitalized module name */
  }

  return new Proxy({} as Record<string, unknown>, {
    get(_target, methodName: string) {
      switch (methodName) {
        case 'create':
          return async (data: Record<string, unknown>) => {
            const result = await stepApi.create(entity, data, ctx)
            const id = (result as Record<string, unknown>).id as string
            const existing = ids.get(entity) ?? []
            existing.push(id)
            ids.set(entity, existing)
            return result
          }
        case 'update':
          return (id: string, data: Record<string, unknown>) => stepApi.update(entity, id, data, ctx)
        case 'delete':
          return (id: string) => stepApi.delete(entity, id, ctx)
        case 'link':
          return new Proxy({} as Record<string, Function>, {
            get(_t, rightEntityProp: string) {
              // step.product.link.inventoryItem()
              // step.product.link.inventoryItem({ extraCol: value })
              return async (extraColumns?: Record<string, unknown>) => {
                const rightEntity = rightEntityProp.charAt(0).toUpperCase() + rightEntityProp.slice(1)
                const leftIds = ids.get(entity) ?? []
                const leftId = leftIds[leftIds.length - 1]
                const rightIds = ids.get(rightEntity) ?? []
                const rightId = rightIds[rightIds.length - 1]
                if (!leftId)
                  throw new MantaError(
                    'INVALID_DATA',
                    `Cannot link: no ${entity} created yet in this workflow. Call step.service.${entity.toLowerCase()}.create() first.`,
                  )
                if (!rightId)
                  throw new MantaError(
                    'INVALID_DATA',
                    `Cannot link: no ${rightEntity} created yet in this workflow. Call step.service.${rightEntity.toLowerCase()}.create() first.`,
                  )
                return stepApi.linkExplicit(entity, leftId, rightEntity, rightId, ctx, extraColumns)
              }
            },
          })
        default:
          // Service compensable methods (activate, archive, etc.)
          return (...args: unknown[]) => stepApi.invoke(moduleName, methodName, args, ctx)
      }
    },
  })
}

function createBoundStepProxy(entities: Record<string, unknown>, ctx: StepContext, moduleScope?: string): unknown {
  // Shared ID tracker across all module proxies
  const ids: EntityIdMap = new Map()

  // Resolve which entity names this command can access
  // If moduleScope is set, only entities from that module are allowed
  let allowedEntities: Set<string> | null = null
  if (moduleScope) {
    allowedEntities = new Set<string>()
    const modules = ctx.app.modules as Record<string, unknown>
    const mod = modules[moduleScope] as Record<string, unknown> | undefined
    if (mod?.__entity) {
      allowedEntities.add((mod.__entity as { name: string }).name.toLowerCase())
    }
    // Also check all modules for entities registered under this module scope
    for (const [key, svc] of Object.entries(modules)) {
      const s = svc as Record<string, unknown>
      if (s?.__entity) {
        // Entity belongs to this module if it was registered under the module name
        const entityName = (s.__entity as { name: string }).name.toLowerCase()
        // Check if this entity key starts with module scope name
        if (key === moduleScope || key === `${moduleScope}Service`) {
          allowedEntities.add(entityName)
        }
      }
    }
    // Also add entities from the entities map if provided
    for (const key of Object.keys(entities)) {
      allowedEntities.add(key.toLowerCase())
    }
  }

  // Bound service namespace — step.service.catalog.create({...}) (no ctx needed)
  // If moduleScope is set, only allows access to the module's own entities
  const boundServiceProxy = new Proxy({} as Record<string, unknown>, {
    get(_target, moduleName: string) {
      if (allowedEntities && !allowedEntities.has(moduleName.toLowerCase())) {
        throw new MantaError(
          'FORBIDDEN',
          `Command scoped to module "${moduleScope}" cannot access "${moduleName}". ` +
            `Intra-module commands can only use their own entities. ` +
            `Use a cross-module command in src/commands/ to orchestrate across modules.`,
        )
      }
      return createBoundModuleProxy(moduleName, ctx, ids)
    },
  })

  // Bound command namespace — step.command.createProduct({...}) (no ctx needed)
  const boundCommandProxy = new Proxy({} as Record<string, unknown>, {
    get(_target, commandName: string) {
      return async (input: unknown) => {
        return stepApi.command[commandName](input, ctx)
      }
    },
  })

  // Bound agent namespace — step.agent.categorizeProduct({...}) (no ctx needed)
  const boundAgentProxy = new Proxy({} as Record<string, unknown>, {
    get(_target, agentName: string) {
      return async (input: unknown) => {
        return stepApi.agent[agentName](input, ctx)
      }
    },
  })

  // Bound link namespace — step.link.customerAddress.list({...}) (no ctx needed)
  // Mirrors the global step.link.<name>.{ list, create, update, delete } API.
  const boundLinkProxy = new Proxy({} as Record<string, unknown>, {
    get(_target, linkName: string) {
      return {
        list: async (where: Record<string, unknown>) => {
          return stepApi.link[linkName].list(where, ctx)
        },
        create: async (data: Record<string, unknown>) => {
          return stepApi.link[linkName].create(data, ctx)
        },
        update: async (where: Record<string, unknown>, patch: Record<string, unknown>) => {
          return stepApi.link[linkName].update(where, patch, ctx)
        },
        delete: async (where: Record<string, unknown>) => {
          return stepApi.link[linkName].delete(where, ctx)
        },
      }
    },
  })

  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string) {
      if (prop === 'service') return boundServiceProxy
      if (prop === 'command') return boundCommandProxy
      if (prop === 'link') return boundLinkProxy
      if (prop === 'agent') return boundAgentProxy
      if (prop === 'emit') {
        return (eventName: string, data: Record<string, unknown>) => {
          return stepApi.emit(eventName, data, ctx)
        }
      }
      if (prop === 'action') {
        return (name: string, config: ActionStepConfig) => {
          const actionFn = stepApi.action(name, config)
          return (input: unknown) => actionFn(input, ctx)
        }
      }
      // Fallback for backward compat during migration
      return createBoundModuleProxy(prop, ctx, ids)
    },
  })
}

// ── defineCommand ────────────────────────────────────────────────────

/**
 * Define a command.
 *
 * With `entities`: types come from the explicit declaration.
 * Without `entities`: types come from MantaEntities (auto-generated at boot in .manta/types.ts).
 *
 * @example
 * // With codegen (no entities needed):
 * defineCommand({
 *   name: 'create-product',
 *   input: z.object({ title: z.string() }),
 *   workflow: async (input, { step }) => {
 *     const product = await step.product.create({ title: input.title })
 *   }
 * })
 *
 * // With explicit entities (before codegen is set up):
 * defineCommand({
 *   name: 'create-product',
 *   entities: { product: Product, inventoryItem: InventoryItem },
 *   input: z.object({ title: z.string() }),
 *   workflow: async (input, { step }) => { ... }
 * })
 */
// biome-ignore lint/suspicious/noExplicitAny: DmlEntity generics
export function defineCommand<TOutput, TEntities extends Record<string, DmlEntity<any>>, TSchema extends z.ZodType>(
  config: TypedCommandConfig<unknown, TOutput, TEntities, TSchema>,
): CommandDefinition<z.output<TSchema>, TOutput>

// Legacy overload — without entities, raw (input, ctx) signature
export function defineCommand<TInput, TOutput>(
  config: CommandDefinition<TInput, TOutput>,
): CommandDefinition<TInput, TOutput>

// Implementation
// biome-ignore lint/suspicious/noExplicitAny: overload implementation
export function defineCommand(config: any): CommandDefinition {
  if (!config.name)
    throw new MantaError(
      'INVALID_DATA',
      'Command name is required. Usage: defineCommand({ name: "create-product", description: "...", input: z.object({...}), workflow: async (input, { step }) => {...} })',
    )
  if (!config.description)
    throw new MantaError(
      'INVALID_DATA',
      `Command "${config.name}" requires a description (used for AI tool discovery and documentation)`,
    )
  if (!config.input)
    throw new MantaError(
      'INVALID_DATA',
      `Command "${config.name}" requires an input Zod schema. Use z.object({}) for commands with no input.`,
    )
  if (typeof config.workflow !== 'function')
    throw new MantaError(
      'INVALID_DATA',
      `Command "${config.name}" workflow must be an async function: workflow: async (input, { step }) => {...}`,
    )

  // Always wrap workflow to inject typed step proxy.
  // The user's workflow receives (input, { step, log }), the bootstrap calls (input, ctx).
  // If __moduleScope is set (intra-module command), the step proxy is filtered.
  const userWorkflow = config.workflow
  const moduleScope = config.__moduleScope
  return {
    __type: 'command' as const,
    name: config.name,
    description: config.description,
    input: config.input,
    __moduleScope: moduleScope,
    workflow: async (input: unknown, ctx: StepContext) => {
      const step = createBoundStepProxy(config.entities ?? {}, ctx, moduleScope)
      // auth + headers come from the HTTP route, injected by bootstrap into __httpCtx
      const httpCtx = (ctx as unknown as Record<string, unknown>).__httpCtx as
        | { auth?: unknown; headers?: Record<string, string | undefined> }
        | undefined
      return userWorkflow(input, {
        step,
        log: ctx.app?.infra?.logger ?? console,
        auth: httpCtx?.auth ?? null,
        headers: httpCtx?.headers ?? {},
      })
    },
  }
}

// ── CommandRegistry ──────────────────────────────────────────────────

interface RegistryEntry {
  name: string
  description: string
  inputSchema: z.ZodType
  workflow: (input: unknown, ctx: unknown) => Promise<unknown>
}

export class CommandRegistry {
  private _entries = new Map<string, RegistryEntry>()

  // biome-ignore lint/suspicious/noExplicitAny: commands have varied type params
  register(def: CommandDefinition<any, any>): void {
    if (this._entries.has(def.name)) {
      throw new MantaError('DUPLICATE_ERROR', `Command "${def.name}" is already registered`)
    }
    this._entries.set(def.name, {
      name: def.name,
      description: def.description,
      inputSchema: def.input,
      workflow: def.workflow as (input: unknown, ctx: unknown) => Promise<unknown>,
    })
  }

  get(name: string): RegistryEntry | undefined {
    return this._entries.get(name)
  }

  list(): RegistryEntry[] {
    return [...this._entries.values()]
  }

  /** Generate tool schemas for AI discovery (commands + query) */
  toToolSchemas(): CommandToolSchema[] {
    const schemas: CommandToolSchema[] = [QUERY_TOOL_SCHEMA]
    for (const entry of this._entries.values()) {
      schemas.push({
        name: entry.name,
        description: entry.description,
        input_schema: zodToJsonSchema(entry.inputSchema),
      })
    }
    return schemas
  }

  _reset(): void {
    this._entries.clear()
  }
}

// ── QUERY_TOOL_SCHEMA ────────────────────────────────────────────────

export const QUERY_TOOL_SCHEMA: CommandToolSchema = {
  name: 'query',
  description: 'Query entities from the database. Supports filtering, pagination, and field selection.',
  input_schema: {
    type: 'object',
    properties: {
      entity: { type: 'string', description: 'Entity name to query (e.g. "product", "inventory")' },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Fields to return (optional, returns all by default)',
      },
      filters: {
        type: 'object',
        description: 'Filter conditions (e.g. { status: "active" })',
      },
      limit: { type: 'number', description: 'Max results to return (default: 100)' },
      offset: { type: 'number', description: 'Offset for pagination' },
    },
    required: ['entity'],
  },
}

// ── zodToJsonSchema ──────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: Zod internals use _def with varying shapes per typeName
type ZodDef = { typeName?: string; [key: string]: any }

// biome-ignore lint/suspicious/noExplicitAny: Zod internals use _def with varying shapes
export function zodToJsonSchema(schema: z.ZodType<any>): Record<string, unknown> {
  const def = (schema as unknown as { _def: ZodDef })._def
  const typeName: string = def?.typeName ?? ''

  if (typeName === 'ZodObject') {
    const shape: Record<string, z.ZodTypeAny> = def.shape?.() ?? {}
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [key, value] of Object.entries(shape)) {
      const prop = value
      properties[key] = zodToJsonSchema(prop)
      const innerTypeName = (prop as unknown as { _def?: { typeName?: string } })._def?.typeName ?? ''
      if (innerTypeName !== 'ZodOptional' && innerTypeName !== 'ZodDefault') required.push(key)
    }
    return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
  }

  if (typeName === 'ZodString') return { type: 'string' }
  if (typeName === 'ZodNumber') return { type: 'number' }
  if (typeName === 'ZodBoolean') return { type: 'boolean' }
  if (typeName === 'ZodArray') return { type: 'array', items: zodToJsonSchema(def.type) }
  if (typeName === 'ZodEnum') return { type: 'string', enum: def.values }
  if (typeName === 'ZodOptional') return zodToJsonSchema(def.innerType)
  if (typeName === 'ZodDefault') return { ...zodToJsonSchema(def.innerType), default: def.defaultValue() }
  if (typeName === 'ZodNullable') return { ...zodToJsonSchema(def.innerType), nullable: true }
  if (typeName === 'ZodUnion') {
    // biome-ignore lint/suspicious/noExplicitAny: Zod internal option types
    const options = def.options.map((o: z.ZodType<any>) => zodToJsonSchema(o))
    return { oneOf: options }
  }
  if (typeName === 'ZodDiscriminatedUnion') {
    // biome-ignore lint/suspicious/noExplicitAny: Zod internal option types
    const options = [...def.options.values()].map((o: z.ZodType<any>) => zodToJsonSchema(o))
    return { oneOf: options }
  }
  if (typeName === 'ZodLiteral') {
    const value = def.value
    return { type: typeof value, const: value }
  }
  if (typeName === 'ZodDate') return { type: 'string', format: 'date-time' }
  if (typeName === 'ZodEffects') return zodToJsonSchema(def.schema)
  if (typeName === 'ZodRecord') return { type: 'object', additionalProperties: zodToJsonSchema(def.valueType) }
  if (typeName === 'ZodTuple') {
    // biome-ignore lint/suspicious/noExplicitAny: Zod internal tuple item types
    const items = def.items.map((i: z.ZodType<any>) => zodToJsonSchema(i))
    return { type: 'array', items, minItems: items.length, maxItems: items.length }
  }
  if (typeName === 'ZodIntersection') {
    return { allOf: [zodToJsonSchema(def.left), zodToJsonSchema(def.right)] }
  }
  if (typeName === 'ZodNull') return { type: 'null' }
  if (typeName === 'ZodAny') return {}
  if (typeName === 'ZodNativeEnum') {
    const values = Object.values(def.values).filter(
      (v): v is string | number => typeof v === 'string' || typeof v === 'number',
    )
    return { enum: values }
  }
  if (typeName === 'ZodLazy') return zodToJsonSchema(def.getter())

  return {}
}

export type { CommandAccessMap, CommandAccessRule, CommandGraphDefinition } from './define-command-graph'

// --- Command Graph ---
export {
  defineCommandGraph,
  getCommandScope,
  isCommandAllowed,
  isModuleAllowed,
} from './define-command-graph'
export type { EntityZodSchemas } from './dml-to-zod'

// --- DML → Zod ---
export { dmlToZod } from './dml-to-zod'
export type { EntityCommand, EntityCommandOperation } from './generate-entity-commands'

// --- Auto-generated entity commands ---
export { generateEntityCommands, generateLinkCommands, generateModuleCommands } from './generate-entity-commands'
export type {
  CommandDefinition,
  CommandToolSchema,
  MantaCommands,
  MantaEntities,
  TypedCommandConfig,
  TypedStep,
} from './types'
