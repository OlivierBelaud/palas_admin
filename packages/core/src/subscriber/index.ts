// SPEC-034/035 — Subscriber system utilities
// Subscribers receive (event, { command, log }) — they can ONLY dispatch commands.
// No direct module access. Every mutation goes through a workflow.

import type { MantaCommands } from '../command/types'
import { MantaError } from '../errors/manta-error'
import type { MantaEventMap, Message } from '../events/types'
import type { ICachePort } from '../ports/cache'
import type { IEventBusPort } from '../ports/event-bus'
import type { ILoggerPort } from '../ports/logger'

/**
 * Subscriber handler function type (legacy — receives raw Message).
 */
export type SubscriberHandler<T = unknown> = (event: Message<T>) => Promise<void> | void

/**
 * Subscriber configuration for auto-discovery.
 */
export interface SubscriberConfig {
  event: string | string[]
  subscriberId?: string
  context?: { subscriberId?: string }
}

/**
 * Subscriber module default export shape.
 */
export interface SubscriberExport {
  config: SubscriberConfig
  handler: SubscriberHandler
}

/**
 * Scoped context passed as arg 2 to subscriber handlers.
 * - `command` — CQRS command callables
 * - `log` — logger instance
 */
export interface SubscriberScope {
  command: MantaCommands
  log: ILoggerPort
}

/**
 * @deprecated Use SubscriberScope instead. Kept for backward compat.
 */
export interface SubscriberContext<T = unknown> {
  event: Message<T>
  command: MantaCommands
  log: ILoggerPort
}

/**
 * Typed subscriber definition.
 *
 * Handler receives: (event, { command, log })
 *   - arg 1: the incoming Message
 *   - arg 2: scoped methods from the framework
 *
 * @example
 * export default defineSubscriber({
 *   event: 'order.placed',
 *   handler: async (event, { command }) => {
 *     await command.reserveStock({ itemId: event.data.itemId })
 *   },
 * })
 */
export interface SubscriberDefinition<T = unknown> {
  event: string | string[]
  subscriberId?: string
  handler: (event: Message<T>, scope: SubscriberScope) => Promise<void> | void
}

/**
 * Define a typed subscriber.
 * When event matches a key in MantaEventMap (populated by codegen), event.data is auto-typed.
 * Handler receives (event, { command, log }) — can only dispatch commands, not access modules directly.
 *
 * @example
 * // String form (preferred) — event name autocompletes from MantaEventMap
 * export default defineSubscriber('order.placed', async (event, { command }) => {
 *   await command.reserveStock({ itemId: event.data.itemId })
 * })
 *
 * @example
 * // Object form — for subscriberId or multi-event
 * export default defineSubscriber({
 *   event: ['order.created', 'order.updated'],
 *   subscriberId: 'order-sync',
 *   handler: async (event, { command }) => { ... },
 * })
 */

// ── String form: defineSubscriber('event.name', handler) ─────────────
// No string fallback — codegen generates DefineSubscriberFn with explicit
// event overloads. Without codegen, use the object form.

/** Typed overload — event name from MantaEventMap, data auto-typed. */
export function defineSubscriber<E extends keyof MantaEventMap>(
  event: E,
  handler: (event: Message<MantaEventMap[E]>, scope: SubscriberScope) => Promise<void> | void,
): SubscriberDefinition<MantaEventMap[E]> & { __type: 'subscriber' }

// ── Object form: defineSubscriber({ event, handler }) ────────────────

/** Typed object overload — event name from MantaEventMap. */
export function defineSubscriber<E extends keyof MantaEventMap>(config: {
  event: E
  subscriberId?: string
  handler: (event: Message<MantaEventMap[E]>, scope: SubscriberScope) => Promise<void> | void
}): SubscriberDefinition<MantaEventMap[E]> & { __type: 'subscriber' }

/** Fallback object overload for unknown events or multi-event subscribers. */
export function defineSubscriber<T = unknown>(
  config: SubscriberDefinition<T>,
): SubscriberDefinition<T> & { __type: 'subscriber' }

// ── Implementation ───────────────────────────────────────────────────

export function defineSubscriber<T = unknown>(
  eventOrConfig: string | SubscriberDefinition<T>,
  handler?: (event: Message<T>, scope: SubscriberScope) => Promise<void> | void,
): SubscriberDefinition<T> & { __type: 'subscriber' } {
  // String form: defineSubscriber('event.name', handler)
  if (typeof eventOrConfig === 'string') {
    if (!eventOrConfig) {
      throw new MantaError('INVALID_DATA', 'Subscriber event must be a non-empty string')
    }
    if (typeof handler !== 'function') {
      throw new MantaError('INVALID_DATA', 'Subscriber handler must be a function')
    }
    return { event: eventOrConfig, handler, __type: 'subscriber' as const } as SubscriberDefinition<T> & {
      __type: 'subscriber'
    }
  }

  // Object form: defineSubscriber({ event, handler })
  const config = eventOrConfig
  if (!config.event || (Array.isArray(config.event) && config.event.length === 0)) {
    throw new MantaError('INVALID_DATA', 'Subscriber event must be a non-empty string or array')
  }
  if (typeof config.handler !== 'function') {
    throw new MantaError('INVALID_DATA', 'Subscriber handler must be a function')
  }
  return Object.assign(config, { __type: 'subscriber' as const })
}

/**
 * Register a subscriber with the event bus.
 * Convenience wrapper around IEventBusPort.subscribe().
 */
export function registerSubscriber(
  eventBus: IEventBusPort,
  config: SubscriberConfig,
  handler: SubscriberHandler,
): void {
  const events = Array.isArray(config.event) ? config.event : [config.event]
  const subscriberId = config.subscriberId ?? config.context?.subscriberId

  for (const eventName of events) {
    eventBus.subscribe(eventName, handler, subscriberId ? { subscriberId } : undefined)
  }
}

/**
 * makeIdempotent() — wraps a subscriber handler for at-least-once deduplication.
 *
 * Uses ICachePort to track processed events. Default key: `${eventName}:${data.id}`.
 * Default TTL: 24 hours.
 *
 * Usage:
 *   const handler = makeIdempotent(cache, async (event) => { ... })
 */
export function makeIdempotent<T = unknown>(
  cache: ICachePort,
  handler: SubscriberHandler<T>,
  options?: {
    keyFn?: (event: Message<T>) => string
    ttl?: number
  },
): SubscriberHandler<T> {
  const ttl = options?.ttl ?? 86400 // 24 hours
  const keyFn =
    options?.keyFn ??
    ((event: Message<T>) => {
      const data = event.data as Record<string, unknown> | null
      const id = data?.id ?? 'unknown'
      return `idempotent:${event.eventName}:${id}`
    })

  return async (event: Message<T>) => {
    const key = keyFn(event)
    try {
      const existing = await cache.get(key)
      if (existing !== null && existing !== undefined) {
        return // Already processed — skip
      }
    } catch {
      // Cache unavailable — proceed without dedup (at-least-once guarantee)
    }

    await handler(event)

    try {
      // Mark as processed
      await cache.set(key, '1', ttl)
    } catch {
      // Cache unavailable — next invocation may re-process
    }
  }
}
