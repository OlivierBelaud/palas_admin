// service.define() — Functional, typed API for defining module services.
//
// Services = mutations only (CQRS). Reads go through the Query Graph.
// Compensation is automatic — the repo snapshots state before every mutation.
// No service.method() needed. Just write async functions.
//
// Usage:
//   export default defineService('product', ({ db, log }) => ({
//     publish: async (id: string) => {
//       await db.update({ id, status: 'published' })
//       log.info(`Product ${id} published`)
//     },
//   }))

import type { DmlEntity } from '../dml/entity'
import type { InferEntity } from '../dml/infer'
import type { ModelProxy, ModelRef } from '../link/index'
import { createModelProxy } from '../link/index'
import type { ILoggerPort } from '../ports/logger'
import type { CursorPagination } from '../ports/types'

/**
 * Typed repository — wraps IRepository with entity-typed methods.
 * Mutations (update, delete, create) are auto-snapshotted for compensation.
 */
export interface TypedRepository<T> {
  find(options?: {
    where?: Partial<T>
    withDeleted?: boolean
    limit?: number
    offset?: number
    order?: Partial<Record<keyof T & string, 'ASC' | 'DESC'>>
    cursor?: CursorPagination
  }): Promise<T[]>
  findAndCount(options?: {
    where?: Partial<T>
    withDeleted?: boolean
    limit?: number
    offset?: number
    order?: Partial<Record<keyof T & string, 'ASC' | 'DESC'>>
  }): Promise<[T[], number]>
  create(data: Partial<T> | Partial<T>[]): Promise<T | T[]>
  update(data: Partial<T> & { id: string }): Promise<T>
  delete(ids: string | string[]): Promise<void>
  softDelete(ids: string | string[]): Promise<Record<string, string[]>>
  restore(ids: string | string[]): Promise<void>
  upsertWithReplace(data: Partial<T>[], replaceFields?: string[], conflictTarget?: string[]): Promise<T[]>
}

/**
 * Service methods — plain async functions. No compensation wrapper needed.
 * The framework auto-snapshots repo mutations for rollback.
 */
// biome-ignore lint/suspicious/noExplicitAny: generic constraint for any async method
type ServiceMethods = Record<string, (...args: any[]) => Promise<any>>

/**
 * Context passed to the service factory.
 * - `db` — typed repository for CRUD operations
 * - `log` — logger instance
 */
export interface ServiceFactoryContext<T> {
  db: TypedRepository<T>
  log: ILoggerPort
}

/**
 * Service descriptor — the output of defineService().
 * Contains metadata for bootstrap to instantiate the service.
 */
// biome-ignore lint/suspicious/noExplicitAny: DmlEntity generic
export interface ServiceDescriptor<E extends DmlEntity<any> = DmlEntity<any>, Methods = ServiceMethods> {
  __type: 'service'
  entity: E
  factory: (ctx: ServiceFactoryContext<InferEntity<E>>) => Methods
  $modelObjects: Record<string, E>
  /** Methods exposed to other modules via app.modules.*. If undefined, all methods are public. */
  publicMethods?: string[]
  /** Entity name (resolved from string or callback). */
  _entityName?: string
}

/**
 * Type guard: is this value a ServiceDescriptor?
 */
// biome-ignore lint/suspicious/noExplicitAny: type guard
export function isServiceDescriptor(value: unknown): value is ServiceDescriptor<any, any> {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).__type === 'service'
}

/**
 * Entity name type — autocompletes from MantaGeneratedEntities (codegen),
 * but accepts any string before codegen has run.
 */
type EntityNameArg = keyof MantaGeneratedEntities | (string & {})

/**
 * Define a service for a DML entity.
 *
 * ```ts
 * export default defineService('product', ({ db, log }) => ({
 *   publish: async (id: string) => {
 *     await db.update({ id, status: 'published' })
 *     log.info(`Product ${id} published`)
 *   },
 * }))
 * ```
 *
 * Compensation is automatic — the repo snapshots state before every mutation.
 */
// biome-ignore lint/suspicious/noExplicitAny: generic constraint for any async method
export function defineService<Methods extends ServiceMethods>(
  entity: EntityNameArg,
  factory: (ctx: ServiceFactoryContext<any>) => Methods,
  options?: { publicMethods?: (keyof Methods & string)[] },
): ServiceDescriptor<any, Methods>

/**
 * @deprecated Use string form: `defineService('product', factory)`.
 * Callback form kept for backward compatibility during migration.
 */
// biome-ignore lint/suspicious/noExplicitAny: generic constraint for any async method
export function defineService<Methods extends ServiceMethods>(
  entitySelector: (model: ModelProxy) => ModelRef,
  factory: (ctx: ServiceFactoryContext<any>) => Methods,
  options?: { publicMethods?: (keyof Methods & string)[] },
): ServiceDescriptor<any, Methods>

// ── Implementation ──────────────────────────────────────────────────
// biome-ignore lint/suspicious/noExplicitAny: generic constraint for any async method
export function defineService<Methods extends ServiceMethods>(
  entityOrSelector: EntityNameArg | ((model: ModelProxy) => ModelRef),
  factory: (ctx: ServiceFactoryContext<any>) => Methods,
  options?: { publicMethods?: (keyof Methods & string)[] },
): ServiceDescriptor<any, Methods> {
  let entityName: string

  if (typeof entityOrSelector === 'string') {
    entityName = entityOrSelector
  } else {
    // Legacy callback form
    const proxy = createModelProxy()
    const ref = entityOrSelector(proxy)
    entityName = ref.entityName
  }

  return {
    __type: 'service' as const,
    // biome-ignore lint/suspicious/noExplicitAny: entity is resolved at boot time from _entityName
    entity: null as unknown as DmlEntity<any>,
    factory,
    $modelObjects: {},
    publicMethods: options?.publicMethods,
    _entityName: entityName,
  }
}
