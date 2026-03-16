// SPEC-058 — createService() base class with 7 CRUD methods

import type { IRepository } from '../ports/repository'
import type { Context } from '../ports/types'
import type { IMessageAggregator } from '../events/types'
import { MantaError } from '../errors/manta-error'

/**
 * Options for configuring service queries.
 */
export interface ServiceConfig {
  select?: string[]
  relations?: string[]
  withDeleted?: boolean
  order?: Record<string, 'asc' | 'desc'>
  skip?: number
  take?: number
  filters?: Record<string, unknown>
}

/**
 * Build event names from a model name.
 * E.g. buildEventNamesFromModelName('product') => { created: 'product.created', ... }
 */
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

/**
 * Pluralize an entity name for method generation.
 * Simple English pluralization rules.
 */
function pluralize(name: string): string {
  if (name.endsWith('s') || name.endsWith('x') || name.endsWith('ch') || name.endsWith('sh')) {
    return name + 'es'
  }
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) {
    return name.slice(0, -1) + 'ies'
  }
  return name + 's'
}

/**
 * createService() — generates a base service class with CRUD methods for DML entities.
 *
 * Methods generated per entity:
 *   retrieve{Entity}(context, id, config?) — get one by ID
 *   list{Entities}(context, config?) — list with filters
 *   listAndCount{Entities}(context, config?) — list + count
 *   create{Entities}(context, data[]) — insert
 *   update{Entities}(context, data[]) — update
 *   delete{Entities}(context, ids[]) — hard delete
 *   softDelete{Entities}(context, ids[]) — soft delete
 *   restore{Entities}(context, ids[]) — restore soft-deleted
 *
 * Usage:
 *   const ProductServiceBase = createService({ Product: ProductModel })
 *   class ProductService extends ProductServiceBase { ... }
 */
export function createService(
  models: Record<string, { name?: string }>,
): new (deps: { repository: IRepository; messageAggregator?: IMessageAggregator }) => Record<string, unknown> {
  class GeneratedService {
    protected __repository: IRepository
    protected __messageAggregator: IMessageAggregator | null

    constructor(deps: { repository: IRepository; messageAggregator?: IMessageAggregator }) {
      this.__repository = deps.repository
      this.__messageAggregator = deps.messageAggregator ?? null
    }
  }

  for (const [key, modelDef] of Object.entries(models)) {
    const entityName = modelDef.name ?? key
    const plural = pluralize(entityName)
    const events = buildEventNamesFromModelName(entityName)

    // retrieve{Entity}(context, id, config?)
    Object.defineProperty(GeneratedService.prototype, `retrieve${entityName}`, {
      value: async function (this: GeneratedService, _context: Context, id: string, config?: ServiceConfig) {
        const results = await this.__repository.find({
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

    // list{Entities}(context, config?)
    Object.defineProperty(GeneratedService.prototype, `list${plural}`, {
      value: async function (this: GeneratedService, _context: Context, config?: ServiceConfig) {
        return this.__repository.find({
          where: config?.filters,
          order: config?.order,
          skip: config?.skip,
          take: config?.take,
          withDeleted: config?.withDeleted,
        })
      },
      writable: true,
      configurable: true,
    })

    // listAndCount{Entities}(context, config?)
    Object.defineProperty(GeneratedService.prototype, `listAndCount${plural}`, {
      value: async function (this: GeneratedService, _context: Context, config?: ServiceConfig) {
        return this.__repository.findAndCount({
          where: config?.filters,
          order: config?.order,
          skip: config?.skip,
          take: config?.take,
          withDeleted: config?.withDeleted,
        })
      },
      writable: true,
      configurable: true,
    })

    // create{Entities}(context, data[])
    Object.defineProperty(GeneratedService.prototype, `create${plural}`, {
      value: async function (this: GeneratedService, context: Context, data: Record<string, unknown>[]) {
        const created = await this.__repository.create(data)
        // Emit events via messageAggregator
        if (this.__messageAggregator) {
          const messages = created.map((entity: Record<string, unknown>) => ({
            eventName: events.created,
            data: { id: entity.id },
            metadata: {
              timestamp: Date.now(),
              auth_context: context.auth_context,
            },
          }))
          this.__messageAggregator.save(messages)
        }
        return created
      },
      writable: true,
      configurable: true,
    })

    // update{Entities}(context, data[])
    Object.defineProperty(GeneratedService.prototype, `update${plural}`, {
      value: async function (this: GeneratedService, context: Context, data: Array<Record<string, unknown> & { id: string }>) {
        const updated: Record<string, unknown>[] = []
        for (const item of data) {
          const result = await this.__repository.update(item)
          updated.push(result)
        }
        if (this.__messageAggregator) {
          const messages = updated.map((entity: Record<string, unknown>) => ({
            eventName: events.updated,
            data: { id: entity.id },
            metadata: {
              timestamp: Date.now(),
              auth_context: context.auth_context,
            },
          }))
          this.__messageAggregator.save(messages)
        }
        return updated
      },
      writable: true,
      configurable: true,
    })

    // delete{Entities}(context, ids[])
    Object.defineProperty(GeneratedService.prototype, `delete${plural}`, {
      value: async function (this: GeneratedService, context: Context, ids: string[]) {
        await this.__repository.delete(ids)
        if (this.__messageAggregator) {
          const messages = ids.map((id) => ({
            eventName: events.deleted,
            data: { id },
            metadata: {
              timestamp: Date.now(),
              auth_context: context.auth_context,
            },
          }))
          this.__messageAggregator.save(messages)
        }
      },
      writable: true,
      configurable: true,
    })

    // softDelete{Entities}(context, ids[])
    Object.defineProperty(GeneratedService.prototype, `softDelete${plural}`, {
      value: async function (this: GeneratedService, _context: Context, ids: string[]) {
        return this.__repository.softDelete(ids)
      },
      writable: true,
      configurable: true,
    })

    // restore{Entities}(context, ids[])
    Object.defineProperty(GeneratedService.prototype, `restore${plural}`, {
      value: async function (this: GeneratedService, _context: Context, ids: string[]) {
        return this.__repository.restore(ids)
      },
      writable: true,
      configurable: true,
    })
  }

  return GeneratedService as unknown as new (deps: { repository: IRepository; messageAggregator?: IMessageAggregator }) => Record<string, unknown>
}
