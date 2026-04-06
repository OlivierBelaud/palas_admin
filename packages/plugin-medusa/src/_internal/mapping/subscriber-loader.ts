// Subscriber loader — registers Medusa subscribers into a MantaApp's event bus.
//
// Medusa subscriber signature: handler({ event, container })
//   - event: { name: string, data: unknown, metadata?: unknown }
//   - container: { resolve(key): T }
//
// Manta subscriber signature: handler(message: Message<T>)
//
// Bridge: wrap each Medusa handler to receive { event, container }
// where container = MantaApp (has resolve()).

import type { IEventBusPort, Message } from '@manta/core'
import { addAlert } from '../alerts'
import type { DiscoveredSubscriber } from '../discovery/subscribers'

export interface SubscriberRegistrationResult {
  registered: number
  skipped: number
  failed: number
  errors: string[]
}

/**
 * Adapts a Medusa subscriber handler to Manta's Message-based signature.
 *
 * Medusa handlers expect: ({ event, container }) => Promise<void>
 * Manta handlers expect: (message: Message) => Promise<void>
 *
 * The container proxy exposes resolve() backed by the MantaApp.
 */
export function adaptMedusaHandler(
  // biome-ignore lint/suspicious/noExplicitAny: Medusa handler is untyped
  medusaHandler: (args: any) => Promise<void> | void,
  appResolve: <T = unknown>(key: string) => T,
): (message: Message) => Promise<void> {
  return async (message: Message) => {
    // Build the Medusa-compatible event shape
    const medusaEvent = {
      name: message.eventName,
      data: message.data,
      metadata: message.metadata,
    }

    // Build a container proxy with resolve()
    const container = {
      resolve: appResolve,
    }

    await medusaHandler({ event: medusaEvent, container })
  }
}

/**
 * Register all discovered Medusa subscribers into the event bus.
 *
 * Each subscriber's handler is wrapped via adaptMedusaHandler() to bridge
 * the Medusa ({ event, container }) signature to Manta's Message-based one.
 */
export function registerSubscribersInApp(
  eventBus: IEventBusPort,
  subscribers: DiscoveredSubscriber[],
  appResolve: <T = unknown>(key: string) => T,
): SubscriberRegistrationResult {
  let registered = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []

  for (const sub of subscribers) {
    if (!sub.hasHandler) {
      addAlert({
        level: 'warn',
        layer: 'subscriber',
        artifact: sub.name,
        message: 'Subscriber has no handler — skipped',
      })
      skipped++
      continue
    }

    if (sub.events.length === 0) {
      addAlert({
        level: 'warn',
        layer: 'subscriber',
        artifact: sub.name,
        message: 'Subscriber has no events — skipped',
      })
      skipped++
      continue
    }

    try {
      const adapted = adaptMedusaHandler(sub.handler!, appResolve)
      const subscriberId = sub.subscriberId ?? sub.name

      for (const eventName of sub.events) {
        eventBus.subscribe(eventName, adapted, { subscriberId: `${subscriberId}:${eventName}` })
      }

      registered++

      addAlert({
        level: 'info',
        layer: 'subscriber',
        artifact: sub.name,
        message: `Registered for ${sub.events.length} event(s): ${sub.events.join(', ')}`,
      })
    } catch (err) {
      addAlert({
        level: 'error',
        layer: 'subscriber',
        artifact: sub.name,
        message: `Failed to register: ${(err as Error).message}`,
      })
      failed++
      errors.push(sub.name)
    }
  }

  return { registered, skipped, failed, errors }
}
