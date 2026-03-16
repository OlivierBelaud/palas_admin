// SPEC-034/035 — Subscriber system utilities

import type { IEventBusPort } from '../ports/event-bus'
import type { ICachePort } from '../ports/cache'
import type { Message } from '../events/types'

/**
 * Subscriber handler function type.
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
  const keyFn = options?.keyFn ?? ((event: Message<T>) => {
    const data = event.data as Record<string, unknown> | null
    const id = data?.id ?? 'unknown'
    return `idempotent:${event.eventName}:${id}`
  })

  return async (event: Message<T>) => {
    const key = keyFn(event)
    const existing = await cache.get(key)
    if (existing !== null && existing !== undefined) {
      return // Already processed — skip
    }

    await handler(event)

    // Mark as processed
    await cache.set(key, '1', ttl)
  }
}
