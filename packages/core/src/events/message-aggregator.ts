// SPEC-018 — IMessageAggregator implementation (SCOPED)

import type { Message, IMessageAggregator, GetMessagesOptions } from './types'

/**
 * In-memory message aggregator. SCOPED lifetime — one per request/scope.
 * Accumulates messages from @EmitEvents decorator, releases on success,
 * clears on error.
 */
export class MessageAggregator implements IMessageAggregator {
  private _messages: Message[] = []

  /**
   * Save (accumulate) messages.
   * @param messages - Messages to add
   */
  save(messages: Message[]): void {
    this._messages.push(...messages)
  }

  /**
   * Get all accumulated messages with optional sorting.
   * @param options - groupBy groups internally (returns flat), sortBy sorts by metadata field
   * @returns All accumulated messages
   */
  getMessages(options?: GetMessagesOptions): Message[] {
    let result = [...this._messages]

    if (options?.sortBy === 'timestamp') {
      result.sort((a, b) => a.metadata.timestamp - b.metadata.timestamp)
    }

    return result
  }

  /**
   * Clear all accumulated messages (called on error by @EmitEvents).
   */
  clearMessages(): void {
    this._messages = []
  }
}
