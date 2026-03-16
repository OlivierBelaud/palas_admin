// SPEC-018 — InMemoryMessageAggregator implements IMessageAggregator

import type { IMessageAggregator, Message } from '../ports'

export class InMemoryMessageAggregator implements IMessageAggregator {
  private _messages: Message[] = []

  save(messages: Message[]): void {
    this._messages.push(...messages)
  }

  getMessages(options?: { groupBy?: string; sortBy?: string }): Message[] {
    let result = [...this._messages]

    if (options?.sortBy === 'timestamp') {
      result.sort((a, b) => a.metadata.timestamp - b.metadata.timestamp)
    }

    // groupBy returns flat array (the grouping is for internal use)
    return result
  }

  clearMessages(): void {
    this._messages = []
  }

  _reset() { this._messages = [] }
}
