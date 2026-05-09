// SPEC-097 — INotificationPort interface

/**
 * Notification port contract.
 *
 * The payload is provider-agnostic but biased toward email semantics
 * (subject/html/text/headers/tags) since email is the dominant channel.
 * For other channels (sms, push), the implementation may ignore email-only
 * fields. Adapters MUST validate channel-specific requirements at runtime.
 *
 * `to` is a single recipient. Adapters that natively support multi-recipient
 * sends should expose `sendBatch` instead — the framework's contract is
 * one-recipient-per-call so retries and failures are scoped.
 *
 * `idempotency_key` is the caller's responsibility. Adapters that support
 * native dedupe (e.g. Resend's `Idempotency-Key` header) should forward it;
 * adapters that don't should at minimum maintain in-memory dedupe within the
 * process (see InMemoryNotificationAdapter).
 */
export interface INotificationPort {
  /**
   * Send a notification.
   * @param notification - The notification payload
   * @returns Send result with status and optional id/error
   */
  send(notification: {
    /** Single recipient (email address, phone number, push token...). */
    to: string
    /** Channel name — open string. Common values: `email`, `sms`, `push`. */
    channel: string
    /** Sender. Required for email if no `defaultFrom` is configured on the adapter. */
    from?: string
    /** Reply-to address(es). Email-only. */
    replyTo?: string | string[]
    /** Subject line. Required when `channel === 'email'`. */
    subject?: string
    /** HTML body. At least one of `html` or `text` is required for email. */
    html?: string
    /** Plain-text body. At least one of `html` or `text` is required for email. */
    text?: string
    /** Custom email headers (e.g. `List-Unsubscribe`). */
    headers?: Record<string, string>
    /** Provider tags for analytics/segmentation. */
    tags?: Array<{ name: string; value: string }>
    /** Caller-supplied dedupe key. Adapters forward to provider when supported. */
    idempotency_key?: string
  }): Promise<{ status: 'SUCCESS' | 'FAILURE' | 'PENDING'; id?: string; error?: Error }>

  /**
   * Optional: send multiple notifications in batch.
   * @param notifications - Array of notification payloads
   * @returns Array of send results
   */
  sendBatch?(
    notifications: Array<Parameters<INotificationPort['send']>[0]>,
  ): Promise<Array<Awaited<ReturnType<INotificationPort['send']>>>>

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
