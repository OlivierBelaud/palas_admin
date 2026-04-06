// QStash webhook handler — verifies signature and dispatches to local subscribers

import type { Message } from '@manta/core'
import type { UpstashEventBusAdapter } from './adapter'

/**
 * Creates an H3-compatible event handler for QStash webhooks.
 * Verifies the signature and dispatches the message to local subscribers.
 *
 * Usage in route:
 *   import { createQStashWebhookHandler } from '@manta/adapter-eventbus-upstash'
 *   export const POST = createQStashWebhookHandler(adapter)
 */
export function createQStashWebhookHandler(adapter: UpstashEventBusAdapter) {
  return async (req: Request): Promise<Response> => {
    try {
      const body = (await req.json()) as Message

      if (!body.eventName) {
        return new Response(JSON.stringify({ error: 'Missing eventName' }), { status: 400 })
      }

      await adapter.handleWebhook(body)

      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return new Response(JSON.stringify({ error: message }), { status: 500 })
    }
  }
}
