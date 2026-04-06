// SPEC-097 — InMemoryNotificationAdapter implements INotificationPort

import { MantaError } from '../errors/manta-error'
import type { INotificationPort } from '../ports'

export class InMemoryNotificationAdapter implements INotificationPort {
  private _sent: Array<{
    notification: Parameters<INotificationPort['send']>[0]
    result: Awaited<ReturnType<INotificationPort['send']>>
  }> = []
  private _idempotencyKeys = new Set<string>()
  private _configuredChannels: Set<string> | null = null
  private _failRecipients = new Set<string>()

  /**
   * Configure which channels are accepted. If set, unconfigured channels throw INVALID_DATA.
   */
  configureChannels(channels: string[]): void {
    this._configuredChannels = new Set(channels)
  }

  /**
   * Configure recipients that should simulate failure.
   */
  configureFailures(recipients: string[]): void {
    this._failRecipients = new Set(recipients)
  }

  async send(notification: {
    to: string
    channel: string
    template?: string
    data?: Record<string, unknown>
    idempotency_key?: string
  }): Promise<{ status: 'SUCCESS' | 'FAILURE' | 'PENDING'; id?: string; error?: Error }> {
    // Channel validation (N-04)
    if (this._configuredChannels && !this._configuredChannels.has(notification.channel)) {
      throw new MantaError('INVALID_DATA', `Channel "${notification.channel}" is not configured`)
    }

    // Idempotency check (N-02)
    if (notification.idempotency_key) {
      if (this._idempotencyKeys.has(notification.idempotency_key)) {
        const previous = this._sent.find((s) => s.notification.idempotency_key === notification.idempotency_key)
        return previous?.result ?? { status: 'SUCCESS' }
      }
      this._idempotencyKeys.add(notification.idempotency_key)
    }

    // Simulate failure for configured recipients (N-06)
    if (this._failRecipients.has(notification.to)) {
      const result = { status: 'FAILURE' as const, error: new Error(`Delivery to ${notification.to} failed`) }
      this._sent.push({ notification, result })
      return result
    }

    const result = { status: 'SUCCESS' as const, id: crypto.randomUUID() }
    this._sent.push({ notification, result })
    return result
  }

  async sendBatch(
    notifications: Array<Parameters<INotificationPort['send']>[0]>,
  ): Promise<Array<Awaited<ReturnType<INotificationPort['send']>>>> {
    return Promise.all(notifications.map((n) => this.send(n)))
  }

  /** Test helper: inspect sent notifications */
  getSent() {
    return [...this._sent]
  }
  _reset() {
    this._sent = []
    this._idempotencyKeys.clear()
    this._configuredChannels = null
    this._failRecipients.clear()
  }
}
