// Typed interfaces for runtime-tagged functions and classes.

import type { IMessageAggregator } from '../events/types'

/**
 * A service class constructor with model introspection data.
 * Used by createService() to attach $modelObjects to the class.
 */
export interface IntrospectableServiceConstructor {
  $modelObjects?: Record<string, unknown>
}

/**
 * Prototype extensions added by createService() for Medusa compatibility.
 * These methods are dynamically attached to GeneratedService.prototype.
 */
export interface GeneratedServicePrototype {
  emitEvents_?: (groupedEvents: Record<string, unknown[]>) => Promise<void>
  aggregatedEvents?: (args: {
    action?: unknown
    object?: unknown
    eventName?: unknown
    source?: unknown
    data?: unknown
    context?: { messageAggregator?: IMessageAggregator }
  }) => void
  interceptEntityMutationEvents?: (event: string, args: OrmEventArgs, context: unknown) => void
  MedusaContextIndex_?: Record<string, number>
}

/**
 * ORM event arguments — structured type for MikroORM/Drizzle afterCreate/afterUpdate/afterDelete hooks.
 */
export interface OrmEventArgs {
  entity?: Record<string, unknown>
  changeSet?: {
    entity?: Record<string, unknown>
    originalEntity?: Record<string, unknown>
    name?: string
  }
}
