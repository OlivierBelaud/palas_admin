// SPEC-097 — INotificationPort interface

/**
 * Notification port contract.
 * Adapters: various notification providers (email, SMS, push, etc.).
 */
export interface INotificationPort {
  /**
   * Send a notification.
   * @param notification - The notification payload
   * @returns Send result with status and optional id/error
   */
  send(notification: {
    to: string
    channel: string
    template?: string
    data?: Record<string, unknown>
    idempotency_key?: string
  }): Promise<{ status: 'SUCCESS' | 'FAILURE' | 'PENDING'; id?: string; error?: Error }>

  /**
   * Optional: send multiple notifications in batch.
   * @param notifications - Array of notification payloads
   * @returns Array of send results
   */
  sendBatch?(notifications: Array<Parameters<INotificationPort['send']>[0]>): Promise<Array<Awaited<ReturnType<INotificationPort['send']>>>>

  /**
   * Optional: list sent notifications.
   * @returns Array of notification records
   */
  list?(): Promise<unknown[]>

  /**
   * Optional: retrieve a specific notification by id.
   * @param id - The notification id
   * @returns The notification record or null
   */
  retrieve?(id: string): Promise<unknown | null>
}
