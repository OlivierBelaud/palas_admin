// Subscriber discovery — scans @medusajs/medusa/dist/subscribers/ for event handlers.

import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { addAlert } from '../alerts'

const require = createRequire(import.meta.url)

export interface DiscoveredSubscriber {
  /** File name without extension */
  name: string
  /** Event name(s) the subscriber listens to */
  events: string[]
  /** Subscriber ID */
  subscriberId: string | null
  /** Whether the handler is a function */
  hasHandler: boolean
  /** The actual handler function (if found) */
  // biome-ignore lint/suspicious/noExplicitAny: Medusa handler is untyped
  handler?: (args: any) => Promise<void> | void
}

/**
 * Discover subscribers from @medusajs/medusa/dist/subscribers/.
 */
export function discoverSubscribers(): DiscoveredSubscriber[] {
  let subscribersDir: string
  try {
    const medusaPkg = require.resolve('@medusajs/medusa/package.json')
    subscribersDir = join(dirname(medusaPkg), 'dist', 'subscribers')
  } catch (err) {
    addAlert({
      level: 'error',
      layer: 'subscriber',
      artifact: '@medusajs/medusa',
      message: `Could not resolve @medusajs/medusa: ${(err as Error).message}`,
    })
    return []
  }

  if (!existsSync(subscribersDir)) {
    addAlert({
      level: 'warn',
      layer: 'subscriber',
      artifact: subscribersDir,
      message: 'Subscribers directory not found',
    })
    return []
  }

  const files = readdirSync(subscribersDir).filter((f) => f.endsWith('.js') && !f.endsWith('.js.map'))
  const discovered: DiscoveredSubscriber[] = []

  for (const file of files) {
    const name = file.replace('.js', '')
    try {
      const mod = require(join(subscribersDir, file))
      const handler = mod.default
      const config = mod.config

      const events: string[] = []
      if (config?.event) {
        if (Array.isArray(config.event)) {
          events.push(...config.event)
        } else {
          events.push(config.event)
        }
      }

      discovered.push({
        name,
        events,
        subscriberId: config?.context?.subscriberId || null,
        hasHandler: typeof handler === 'function',
        handler: typeof handler === 'function' ? handler : undefined,
      })
    } catch (err) {
      addAlert({
        level: 'warn',
        layer: 'subscriber',
        artifact: name,
        message: `Could not load subscriber: ${(err as Error).message}`,
      })
    }
  }

  return discovered
}
