// SPEC-058 — createService() base class with CRUD methods
// Signatures aligned with Medusa V2: context is LAST and OPTIONAL.
//   retrieve{Entity}(id, config?, sharedContext?)
//   list{Entities}(filters?, config?, sharedContext?)
//   create{Entities}(data | data[], sharedContext?)
//   update{Entities}(data | data[], sharedContext?)
//   delete{Entities}(ids, sharedContext?)
//   softDelete{Entities}(ids, sharedContext?)
//   restore{Entities}(ids, sharedContext?)

import { MantaError } from '../errors/manta-error'
import type { IMessageAggregator } from '../events/types'
import type { IRepository } from '../ports/repository'
import type { Context } from '../ports/types'
import type { GeneratedServicePrototype, IntrospectableServiceConstructor, OrmEventArgs } from './types'

/**
 * Options for configuring service queries.
 */
export interface ServiceConfig {
  select?: string[]
  relations?: string[]
  withDeleted?: boolean
  order?: Record<string, 'ASC' | 'DESC'>
  skip?: number
  take?: number
}

export function buildEventNamesFromModelName(modelName: string): {
  created: string
  updated: string
  deleted: string
} {
  const name = modelName.toLowerCase()
  return {
    created: `${name}.created`,
    updated: `${name}.updated`,
    deleted: `${name}.deleted`,
  }
}

function pluralize(name: string): string {
  if (name.endsWith('s') || name.endsWith('x') || name.endsWith('ch') || name.endsWith('sh')) {
    return `${name}es`
  }
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) {
    return `${name.slice(0, -1)}ies`
  }
  return `${name}s`
}

/**
 * createService() — generates a base service class with CRUD methods for DML entities.
 *
 * Signatures match Medusa V2 (context last, optional):
 *   retrieve{Entity}(id, config?, sharedContext?)
 *   list{Entities}(filters?, config?, sharedContext?)
 *   listAndCount{Entities}(filters?, config?, sharedContext?)
 *   create{Entities}(data | data[], sharedContext?)
 *   update{Entities}(data | data[], sharedContext?)
 *   delete{Entities}(ids, sharedContext?)
 *   softDelete{Entities}(ids, sharedContext?)
 *   restore{Entities}(ids, sharedContext?)
 */
/**
 * Model input — accepts DmlEntity objects (like Medusa) or plain { name } objects.
 * Usage:
 *   createService({ Product, Variant })           // DmlEntity objects (ISO Medusa)
 *   createService({ Product: { name: 'Product' }}) // Plain objects (legacy)
 */
/**
 * Base interface exposed by createService() return type.
 * Subclasses can access these protected members with proper typing.
 */
export interface GeneratedServiceBase {
  baseRepository_: IRepository
  __container__: Record<string, unknown>
  container_: Record<string, unknown>
}

// biome-ignore lint/suspicious/noExplicitAny: accepts DmlEntity or plain object
export function createService(
  models: Record<string, any>,
): new (
  deps: Record<string, unknown>,
) => GeneratedServiceBase & Record<string, unknown> {
  class GeneratedService {
    protected baseRepository_: IRepository
    protected __messageAggregator: IMessageAggregator | null
    // biome-ignore lint/suspicious/noExplicitAny: Medusa compat — stores the Awilix cradle
    protected __container__: Record<string, any>
    // biome-ignore lint/suspicious/noExplicitAny: Medusa compat alias
    protected container_: Record<string, any>
    /** Event bus service (resolved from deps if available) */
    protected eventBusModuleService_: { emit: (events: unknown[], options?: unknown) => Promise<void> } | undefined

    // biome-ignore lint/suspicious/noExplicitAny: accepts Awilix cradle or explicit deps
    constructor(deps: Record<string, any> = {}) {
      this.baseRepository_ = (deps.baseRepository ?? deps.repository)!
      this.__messageAggregator = deps.messageAggregator ?? null
      this.__container__ = deps
      this.container_ = deps
      // Try to resolve event bus from deps (Medusa pattern)
      try {
        this.eventBusModuleService_ = deps.eventBusModuleService ?? deps.IEventBusPort ?? undefined
      } catch {
        this.eventBusModuleService_ = undefined
      }
    }
  }
  // Store models on the class for introspection (Medusa pattern)
  ;(GeneratedService as unknown as IntrospectableServiceConstructor).$modelObjects = models

  for (const [key, modelDef] of Object.entries(models)) {
    const entityName = modelDef.name ?? key
    const plural = pluralize(entityName)
    const events = buildEventNamesFromModelName(entityName)

    // retrieve{Entity}(id, config?, sharedContext?)
    Object.defineProperty(GeneratedService.prototype, `retrieve${entityName}`, {
      value: async function (this: GeneratedService, id: string, config?: ServiceConfig, _sharedContext?: Context) {
        const results = await this.baseRepository_.find({
          where: { id },
          withDeleted: config?.withDeleted,
        })
        if (results.length === 0) {
          throw new MantaError('NOT_FOUND', `${entityName} with id "${id}" not found`)
        }
        return results[0]
      },
      writable: true,
      configurable: true,
    })

    // list{Entities}(filters?, config?, sharedContext?)
    Object.defineProperty(GeneratedService.prototype, `list${plural}`, {
      value: async function (
        this: GeneratedService,
        filters?: Record<string, unknown>,
        config?: ServiceConfig,
        _sharedContext?: Context,
      ) {
        return this.baseRepository_.find({
          where: filters,
          order: config?.order,
          offset: config?.skip,
          limit: config?.take,
          withDeleted: config?.withDeleted,
        })
      },
      writable: true,
      configurable: true,
    })

    // listAndCount{Entities}(filters?, config?, sharedContext?)
    Object.defineProperty(GeneratedService.prototype, `listAndCount${plural}`, {
      value: async function (
        this: GeneratedService,
        filters?: Record<string, unknown>,
        config?: ServiceConfig,
        _sharedContext?: Context,
      ) {
        return this.baseRepository_.findAndCount({
          where: filters,
          order: config?.order,
          offset: config?.skip,
          limit: config?.take,
          withDeleted: config?.withDeleted,
        })
      },
      writable: true,
      configurable: true,
    })

    // create{Entities}(data | data[], sharedContext?)
    Object.defineProperty(GeneratedService.prototype, `create${plural}`, {
      value: async function (
        this: GeneratedService,
        data: Record<string, unknown> | Record<string, unknown>[],
        sharedContext?: Context,
      ) {
        const items = Array.isArray(data) ? data : [data]
        const created = (await this.baseRepository_.create(items)) as Record<string, unknown>[]
        if (this.__messageAggregator) {
          const messages = created.map((entity: Record<string, unknown>) => ({
            eventName: events.created,
            data: { id: entity.id },
            metadata: {
              timestamp: Date.now(),
              auth_context: sharedContext?.auth_context,
            },
          }))
          this.__messageAggregator.save(messages)
        }
        return Array.isArray(data) ? created : created[0]
      },
      writable: true,
      configurable: true,
    })

    // update{Entities}(data | data[], sharedContext?)
    Object.defineProperty(GeneratedService.prototype, `update${plural}`, {
      value: async function (
        this: GeneratedService,
        data: (Record<string, unknown> & { id: string }) | Array<Record<string, unknown> & { id: string }>,
        sharedContext?: Context,
      ) {
        const items = Array.isArray(data) ? data : [data]
        const updated: Record<string, unknown>[] = []
        for (const item of items) {
          const result = (await this.baseRepository_.update(item)) as Record<string, unknown>
          updated.push(result)
        }
        if (this.__messageAggregator) {
          const messages = updated.map((entity: Record<string, unknown>) => ({
            eventName: events.updated,
            data: { id: entity.id },
            metadata: {
              timestamp: Date.now(),
              auth_context: sharedContext?.auth_context,
            },
          }))
          this.__messageAggregator.save(messages)
        }
        return Array.isArray(data) ? updated : updated[0]
      },
      writable: true,
      configurable: true,
    })

    // delete{Entities}(ids, sharedContext?)
    Object.defineProperty(GeneratedService.prototype, `delete${plural}`, {
      value: async function (this: GeneratedService, ids: string | string[], sharedContext?: Context) {
        const idArray = Array.isArray(ids) ? ids : [ids]
        await this.baseRepository_.delete(idArray)
        if (this.__messageAggregator) {
          const messages = idArray.map((id) => ({
            eventName: events.deleted,
            data: { id },
            metadata: {
              timestamp: Date.now(),
              auth_context: sharedContext?.auth_context,
            },
          }))
          this.__messageAggregator.save(messages)
        }
      },
      writable: true,
      configurable: true,
    })

    // softDelete{Entities}(ids, sharedContext?)
    Object.defineProperty(GeneratedService.prototype, `softDelete${plural}`, {
      value: async function (this: GeneratedService, ids: string | string[], _sharedContext?: Context) {
        const idArray = Array.isArray(ids) ? ids : [ids]
        return this.baseRepository_.softDelete(idArray)
      },
      writable: true,
      configurable: true,
    })

    // restore{Entities}(ids, sharedContext?)
    Object.defineProperty(GeneratedService.prototype, `restore${plural}`, {
      value: async function (this: GeneratedService, ids: string | string[], _sharedContext?: Context) {
        const idArray = Array.isArray(ids) ? ids : [ids]
        return this.baseRepository_.restore(idArray)
      },
      writable: true,
      configurable: true,
    })
  }
  // --- Medusa-compatible event methods ---

  /**
   * emitEvents_ — emit grouped events to the event bus.
   * ISO Medusa: called after entity mutations to emit domain events.
   */
  ;(GeneratedService.prototype as unknown as GeneratedServicePrototype).emitEvents_ = async function (
    this: GeneratedService,
    groupedEvents: Record<string, unknown[]>,
  ) {
    if (!this.eventBusModuleService_ || !groupedEvents) return
    const promises = []
    for (const group of Object.keys(groupedEvents)) {
      promises.push(this.eventBusModuleService_.emit(groupedEvents[group], { internal: true }))
    }
    await Promise.all(promises)
  }

  /**
   * aggregatedEvents — buffer events via MessageAggregator for batch emission.
   * ISO Medusa: called by ORM hooks to aggregate events before committing.
   */
  ;(GeneratedService.prototype as unknown as GeneratedServicePrototype).aggregatedEvents = function (
    this: GeneratedService,
    {
      action,
      object,
      eventName,
      source,
      data,
      context,
    }: {
      action?: unknown
      object?: unknown
      eventName?: unknown
      source?: unknown
      data?: unknown
      context?: { messageAggregator?: IMessageAggregator }
    },
  ) {
    if (!context?.messageAggregator) return
    const messages = [
      {
        eventName: String(eventName ?? `${String(object)}.${String(action)}`),
        data: (data ?? {}) as Record<string, unknown>,
        metadata: {
          timestamp: Date.now(),
          source: String(source ?? ''),
          action: String(action),
          object: String(object),
        },
      },
    ]
    context.messageAggregator.save(messages)
  }

  /**
   * interceptEntityMutationEvents — handles ORM mutation hooks.
   * ISO Medusa: called by MikroORM afterCreate/afterUpdate/afterDelete.
   * In Manta (Drizzle), events are emitted directly in CRUD methods,
   * but this method exists for compatibility with code that calls it.
   */
  ;(GeneratedService.prototype as unknown as GeneratedServicePrototype).interceptEntityMutationEvents = function (
    this: GeneratedService,
    event: string,
    args: OrmEventArgs,
    context: unknown,
  ) {
    // Map ORM events to domain events
    let action = ''
    switch (event) {
      case 'afterCreate':
        action = 'created'
        break
      case 'afterUpdate': {
        const isSoftDeleted = !!args?.changeSet?.entity?.deleted_at && !args?.changeSet?.originalEntity?.deleted_at
        const isRestored = !!args?.changeSet?.originalEntity?.deleted_at && !args?.changeSet?.entity?.deleted_at
        action = isRestored ? 'restored' : isSoftDeleted ? 'deleted' : 'updated'
        break
      }
      case 'afterDelete':
        action = 'deleted'
        break
      default:
        return
    }

    const entity = args?.entity ?? args?.changeSet?.entity
    if (!entity) return

    const entityName = args?.changeSet?.name ?? entity.constructor?.name ?? 'unknown'
    ;(this as unknown as GeneratedServicePrototype).aggregatedEvents?.({
      action,
      object: entityName,
      eventName: `${String(entityName).toLowerCase()}.${action}`,
      data: { id: entity.id },
      context: context as { messageAggregator?: IMessageAggregator },
    })
  }

  /**
   * MedusaContextIndex_ — maps method names to the parameter index of sharedContext.
   * ISO Medusa: used for context auto-injection.
   */
  const contextIndex: Record<string, number> = {}
  for (const [key, modelDef] of Object.entries(models)) {
    const entityName = (modelDef as { name?: string }).name ?? key
    const plural = pluralize(entityName)
    // retrieve(id, config?, context?) → index 2
    contextIndex[`retrieve${entityName}`] = 2
    // list(filters?, config?, context?) → index 2
    contextIndex[`list${plural}`] = 2
    contextIndex[`listAndCount${plural}`] = 2
    // create/update(data, context?) → index 1
    contextIndex[`create${plural}`] = 1
    contextIndex[`update${plural}`] = 1
    // delete(ids, context?) → index 1
    contextIndex[`delete${plural}`] = 1
    // softDelete/restore(ids, config?, context?) → index 2
    contextIndex[`softDelete${plural}`] = 2
    contextIndex[`restore${plural}`] = 2
  }
  ;(GeneratedService.prototype as unknown as GeneratedServicePrototype).MedusaContextIndex_ = contextIndex

  return GeneratedService as unknown as new (
    deps: Record<string, unknown>,
  ) => GeneratedServiceBase & Record<string, unknown>
}

// --- New functional API ---
export type { ServiceDescriptor, ServiceFactoryContext, TypedRepository } from './define'
export { defineService, isServiceDescriptor } from './define'
export { instantiateServiceDescriptor } from './instantiate'
export { SnapshotRepository } from './snapshot-repository'
export type { GeneratedServicePrototype, IntrospectableServiceConstructor, OrmEventArgs } from './types'
