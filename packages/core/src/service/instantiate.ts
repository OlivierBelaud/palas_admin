// instantiateServiceDescriptor() — Runtime wiring for service.define() descriptors.
//
// Generates:
// 1. CRUD methods (retrieve, list, create, update, delete, softDelete, restore)
// 2. Query helpers (list, findById) — for the Query Graph endpoint
// 3. Custom methods from the factory (plain async functions, no compensation wrapper)
//
// The repo injected into the factory is a SnapshotRepository that auto-captures
// state before mutations. The service's __snapshotRepo is used by the workflow
// engine for automatic compensation.

import { MantaError } from '../errors/manta-error'
import type { IMessageAggregator } from '../events/types'
import type { ILoggerPort } from '../ports/logger'
import type { IRepository } from '../ports/repository'
import type { Context } from '../ports/types'
import type { ServiceDescriptor } from './define'
import type { ServiceConfig } from './index'
import { SnapshotRepository } from './snapshot-repository'

function pluralize(name: string): string {
  if (name.endsWith('s') || name.endsWith('x') || name.endsWith('ch') || name.endsWith('sh')) return `${name}es`
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`
  return `${name}s`
}

function buildEventNames(modelName: string) {
  const name = modelName.toLowerCase()
  return { created: `${name}.created`, updated: `${name}.updated`, deleted: `${name}.deleted` }
}

/**
 * Instantiate a ServiceDescriptor into a live service object.
 *
 * @param descriptor - The ServiceDescriptor from service.define()
 * @param repo - A real IRepository instance (injected by bootstrap)
 * @param messageAggregator - Optional message aggregator for domain events
 * @param logger - Optional logger instance for the service factory context
 * @returns The fully-wired service object with CRUD + query helpers + custom methods
 */
export function instantiateServiceDescriptor(
  // biome-ignore lint/suspicious/noExplicitAny: generic descriptor
  descriptor: ServiceDescriptor<any, any>,
  repo: IRepository,
  messageAggregator?: IMessageAggregator,
  logger?: ILoggerPort,
): Record<string, unknown> {
  const entityName = descriptor.entity.name
  const plural = pluralize(entityName)
  const events = buildEventNames(entityName)

  // Wrap the repo in a SnapshotRepository for auto-compensation
  const snapshotRepo = new SnapshotRepository(
    repo as unknown as import('./define').TypedRepository<Record<string, unknown>>,
  )

  // biome-ignore lint/suspicious/noExplicitAny: dynamic service object
  const svc: Record<string, any> = {}

  // ===== Query helpers (framework-generated for the Query Graph endpoint) =====

  svc.list = async (filters?: Record<string, unknown>) => {
    return repo.find({ where: filters, order: { created_at: 'DESC' } })
  }

  svc.findById = async (id: string) => {
    const results = await repo.find({ where: { id } })
    return results[0] ?? null
  }

  // ===== CRUD methods (same semantics as createService) =====

  svc[`retrieve${entityName}`] = async (id: string, config?: ServiceConfig, _sharedContext?: Context) => {
    const results = await repo.find({ where: { id }, withDeleted: config?.withDeleted })
    if (results.length === 0) throw new MantaError('NOT_FOUND', `${entityName} with id "${id}" not found`)
    return results[0]
  }

  svc[`list${plural}`] = async (
    filters?: Record<string, unknown>,
    config?: ServiceConfig,
    _sharedContext?: Context,
  ) => {
    return repo.find({
      where: filters,
      order: config?.order,
      offset: config?.skip,
      limit: config?.take,
      withDeleted: config?.withDeleted,
    })
  }

  svc[`listAndCount${plural}`] = async (
    filters?: Record<string, unknown>,
    config?: ServiceConfig,
    _sharedContext?: Context,
  ) => {
    return repo.findAndCount({
      where: filters,
      order: config?.order,
      offset: config?.skip,
      limit: config?.take,
      withDeleted: config?.withDeleted,
    })
  }

  svc[`create${plural}`] = async (
    data: Record<string, unknown> | Record<string, unknown>[],
    sharedContext?: Context,
  ) => {
    const items = Array.isArray(data) ? data : [data]
    const created = (await repo.create(items)) as Record<string, unknown>[]
    if (messageAggregator) {
      messageAggregator.save(
        created.map((entity) => ({
          eventName: events.created,
          data: { id: entity.id },
          metadata: { timestamp: Date.now(), auth_context: sharedContext?.auth_context },
        })),
      )
    }
    return Array.isArray(data) ? created : created[0]
  }

  svc[`update${plural}`] = async (
    data: (Record<string, unknown> & { id: string }) | Array<Record<string, unknown> & { id: string }>,
    sharedContext?: Context,
  ) => {
    const items = Array.isArray(data) ? data : [data]
    const updated: Record<string, unknown>[] = []
    for (const item of items) {
      const result = (await repo.update(item)) as Record<string, unknown>
      updated.push(result)
    }
    if (messageAggregator) {
      messageAggregator.save(
        updated.map((entity) => ({
          eventName: events.updated,
          data: { id: entity.id },
          metadata: { timestamp: Date.now(), auth_context: sharedContext?.auth_context },
        })),
      )
    }
    return Array.isArray(data) ? updated : updated[0]
  }

  svc[`delete${plural}`] = async (ids: string | string[], sharedContext?: Context) => {
    const idArray = Array.isArray(ids) ? ids : [ids]
    await repo.delete(idArray)
    if (messageAggregator) {
      messageAggregator.save(
        idArray.map((id) => ({
          eventName: events.deleted,
          data: { id },
          metadata: { timestamp: Date.now(), auth_context: sharedContext?.auth_context },
        })),
      )
    }
  }

  svc[`softDelete${plural}`] = async (ids: string | string[], _sharedContext?: Context) => {
    const idArray = Array.isArray(ids) ? ids : [ids]
    return repo.softDelete(idArray)
  }

  svc[`restore${plural}`] = async (ids: string | string[], _sharedContext?: Context) => {
    const idArray = Array.isArray(ids) ? ids : [ids]
    return repo.restore(idArray)
  }

  // ===== Custom methods from factory (plain async functions) =====
  // The factory receives { db, log } so mutations are auto-tracked.
  const noopLogger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
    child() {
      return noopLogger
    },
  } as unknown as ILoggerPort
  const customMethods = descriptor.factory({ db: snapshotRepo as unknown as never, log: logger ?? noopLogger })
  Object.assign(svc, customMethods)

  // ===== Metadata for introspection (AI, query endpoint, etc.) =====
  svc.__entity = descriptor.entity
  svc.__snapshotRepo = snapshotRepo
  svc.__customMethods = Object.keys(customMethods)
  svc.__publicMethods = descriptor.publicMethods ?? null

  return svc
}
