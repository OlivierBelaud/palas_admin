// SPEC-018 — Event types

import type { AuthContext } from '../auth/types'

/**
 * Event data map — augmented by .manta/types/events.d.ts codegen.
 * When codegen runs, `defineSubscriber({ event: 'product.created' })` infers the data type.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by codegen via declare global
export interface MantaEventMap extends MantaGeneratedEventMap {}

/**
 * A message envelope for events emitted through the framework.
 */
export interface Message<T = unknown> {
  eventName: string
  data: T
  metadata: {
    auth_context?: AuthContext
    eventGroupId?: string
    transactionId?: string
    timestamp: number
    idempotencyKey?: string
    source?: string
  }
}

/**
 * Options for retrieving messages from the aggregator.
 */
export interface GetMessagesOptions {
  groupBy?: string
  sortBy?: string
}

/**
 * SPEC-018 — IMessageAggregator contract.
 * One instance per request (via AsyncLocalStorage).
 */
export interface IMessageAggregator {
  /** @param messages - Messages to save (accumulated) */
  save(messages: Message[]): void
  /** @param options - Optional groupBy/sortBy */
  getMessages(options?: GetMessagesOptions): Message[]
  /** Clear all accumulated messages */
  clearMessages(): void
}
