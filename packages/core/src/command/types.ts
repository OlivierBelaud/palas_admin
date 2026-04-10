import type { z } from 'zod'
import type { DmlEntity } from '../dml/entity'
import type { InferEntity } from '../dml/infer'
import type { MantaEventMap } from '../events/types'
import type { ILoggerPort } from '../ports/logger'
import type { StepContext } from '../workflows/types'

// ---------------------------------------------------------------------------
// Create input — required fields are non-nullable, nullable fields are optional
// ---------------------------------------------------------------------------

type ImplicitKeys = 'id' | 'metadata' | 'created_at' | 'updated_at' | 'deleted_at'

/** Extract keys where the value can be null */
type NullableKeys<T> = { [K in keyof T]: null extends T[K] ? K : never }[keyof T]

/** Extract keys where the value cannot be null */
type RequiredKeys<T> = Exclude<keyof T, NullableKeys<T> | ImplicitKeys>

/** Extract keys where the value can be null (minus implicit) */
type OptionalKeys<T> = Exclude<NullableKeys<T>, ImplicitKeys>

/**
 * Create input type: non-nullable fields are required, nullable fields are optional.
 * Implicit columns (id, timestamps) are excluded.
 */
type CreateInput<E> = { [K in RequiredKeys<E>]: E[K] } & { [K in OptionalKeys<E>]?: E[K] }

// ---------------------------------------------------------------------------
// Typed Step — entity-aware, pre-bound to workflow context
// ---------------------------------------------------------------------------

/** Step methods for a single entity module. Typed from DML. */
export type EntityStep<E> = {
  create(data: CreateInput<E>): Promise<E>
  update(id: string, data: Partial<E>): Promise<E>
  delete(id: string): Promise<{
    id: string
    deletedLinks: Array<{ tableName: string; linkId: string }>
    deletedChildren: Array<{ entity: string; id: string }>
    dismissedLinks: Array<{ tableName: string; linkId: string }>
  }>
  link: Record<string, (extraColumns?: Record<string, unknown>) => Promise<{ linkId: string }>>
} & {
  /** Custom service methods (publish, archive, etc.) resolved at runtime via Proxy. */
  // biome-ignore lint/suspicious/noExplicitAny: dynamic service methods
  [method: string]: (...args: any[]) => Promise<any>
}

/**
 * Global entity registry — augmented by .manta/types.ts (auto-generated at boot).
 * When populated, step.product.create() is typed without `entities` declaration.
 */
// biome-ignore lint/suspicious/noExplicitAny: augmented by codegen via declare global
export interface MantaEntities extends MantaGeneratedEntities {}

/** Entity ref for step.link() — tagged object from create() or explicit { entity, id } */
export interface EntityRef {
  entity: string
  id: string
}

/** Step utilities (emit, action, link, agent) */
interface StepUtilities {
  /** Link two entities. Validates that a defineLink exists between them. */
  link<A extends { id: string }, B extends { id: string }>(
    a: A,
    b: B,
    extraColumns?: Record<string, unknown>,
  ): Promise<{ linkId: string }>
  /** Emit a known event with typed data (from MantaEventMap codegen). */
  emit<E extends keyof MantaEventMap>(eventName: E, data: MantaEventMap[E]): Promise<void>
  /** Emit an unknown event (fallback). */
  emit(eventName: string, data: Record<string, unknown>): Promise<void>
  action<TInput, TOutput>(
    name: string,
    config: {
      invoke: (input: TInput, ctx: StepContext) => Promise<TOutput>
      compensate: (output: TOutput, ctx: StepContext) => Promise<void>
    },
  ): (input: TInput) => Promise<TOutput>
  agent: MantaGeneratedAgents
}

/** Service namespace — step.service.MODULE.method() */
// biome-ignore lint/suspicious/noExplicitAny: DmlEntity generic
type ServiceNamespace<TEntities> = {
  [K in keyof TEntities]: TEntities[K] extends DmlEntity<any>
    ? EntityStep<InferEntity<TEntities[K]>>
    : EntityStep<unknown>
}

/** Command namespace — step.command.NAME(input) */
type CommandNamespace = MantaCommands

/**
 * Typed step proxy — categorized.
 * - step.service.MODULE.method() — service CRUD + compensable methods
 * - step.command.NAME(input) — sub-workflow
 * - step.agent.NAME(input) — AI call
 * - step.action(name, config) — external action
 * - step.emit(event, data) — fire event
 */
export type TypedStep<_TEntities = MantaEntities> = {
  service: MantaGeneratedAppModules
  command: CommandNamespace
} & StepUtilities

// ---------------------------------------------------------------------------
// Command Definition
// ---------------------------------------------------------------------------

/** Internal command definition — workflow receives raw (input, ctx). Used by bootstrap/registry. */
export interface CommandDefinition<TInput = unknown, TOutput = unknown> {
  __type: 'command'
  name: string
  description: string
  input: z.ZodType<TInput>
  workflow: (input: TInput, ctx: StepContext) => Promise<TOutput>
  /** If set, this command is scoped to a module — step.service only resolves this module's entities. */
  __moduleScope?: string
}

/** What the developer writes — workflow receives typed { step, log }. */
// biome-ignore lint/suspicious/noExplicitAny: DmlEntity generics
export interface TypedCommandConfig<
  _TInput,
  TOutput,
  TEntities extends Record<string, DmlEntity<any>> = MantaEntities & Record<string, DmlEntity<any>>,
  TSchema extends z.ZodType = z.ZodType,
> {
  name: string
  description: string
  entities?: TEntities
  input: TSchema
  workflow: (
    input: z.output<TSchema>,
    context: {
      step: TypedStep
      log: ILoggerPort
      auth: import('../auth/types').AuthContext | null
      headers: Record<string, string | undefined>
    },
  ) => Promise<TOutput>
}

/**
 * Command callables registry — augmented by .manta/types/ codegen.
 * When codegen runs, `commands.reserveStock()` gets full autocomplete.
 */
// biome-ignore lint/suspicious/noExplicitAny: augmented by codegen
export interface MantaCommands extends MantaGeneratedCommands {}

/** JSON Schema exposed for AI tool discovery */
export interface CommandToolSchema {
  name: string
  description: string
  input_schema: Record<string, unknown>
}
