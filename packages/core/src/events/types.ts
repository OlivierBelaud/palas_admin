// SPEC-018 — Event types

import type { AuthContext } from '../auth/types'

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
 * SCOPED lifetime — each scope gets its own aggregator instance.
 */
export interface IMessageAggregator {
  /** @param messages - Messages to save (accumulated) */
  save(messages: Message[]): void
  /** @param options - Optional groupBy/sortBy */
  getMessages(options?: GetMessagesOptions): Message[]
  /** Clear all accumulated messages */
  clearMessages(): void
}
