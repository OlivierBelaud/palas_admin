// SPEC-097 — ResendNotificationAdapter implements INotificationPort
//
// Maps the framework's provider-agnostic notification payload to the Resend
// SDK's `emails.send()` call. Email-only adapter — sending non-email channels
// throws INVALID_DATA.
//
// Failure modes:
//   - Validation errors (missing subject/from/body) → throw MantaError('INVALID_DATA').
//   - Resend client returns `{ error }` (4xx-style validation/auth/quota errors)
//     → return `{ status: 'FAILURE', error }` so callers can mark/retry per-cart.
//   - Network or transport errors thrown by the SDK → re-thrown as
//     MantaError('UNEXPECTED_STATE') so the workflow runner decides retry policy.

import type { INotificationPort } from '@manta/core'
import { MantaError } from '@manta/core'
import { Resend } from 'resend'

export interface ResendNotificationAdapterOptions {
  /** Resend API key. Defaults to `process.env.RESEND_API_KEY`. */
  apiKey?: string
  /**
   * Default `from` address. Used when the per-call payload omits `from`.
   * Format: `"Display Name <addr@domain>"` or just `"addr@domain"`.
   */
  defaultFrom?: string
  /** Default reply-to address. Used when the per-call payload omits `replyTo`. */
  defaultReplyTo?: string | string[]
}

type SendInput = Parameters<INotificationPort['send']>[0]
type SendResult = Awaited<ReturnType<INotificationPort['send']>>

export class ResendNotificationAdapter implements INotificationPort {
  private _client: Resend
  private _defaultFrom?: string
  private _defaultReplyTo?: string | string[]

  constructor(opts: ResendNotificationAdapterOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.RESEND_API_KEY
    if (!apiKey || apiKey.length === 0) {
      throw new MantaError(
        'INVALID_STATE',
        'ResendNotificationAdapter: missing API key. Pass `apiKey` or set RESEND_API_KEY.',
      )
    }
    this._client = new Resend(apiKey)
    this._defaultFrom = opts.defaultFrom
    this._defaultReplyTo = opts.defaultReplyTo
  }

  async send(notification: SendInput): Promise<SendResult> {
    if (notification.channel !== 'email') {
      throw new MantaError(
        'INVALID_DATA',
        `ResendNotificationAdapter only supports channel="email" (got "${notification.channel}")`,
      )
    }

    if (!notification.subject || notification.subject.length === 0) {
      throw new MantaError('INVALID_DATA', 'Email notifications require a subject')
    }
    if (!notification.html && !notification.text) {
      throw new MantaError('INVALID_DATA', 'Email notifications require html or text body')
    }

    const from = notification.from ?? this._defaultFrom
    if (!from) {
      throw new MantaError(
        'INVALID_DATA',
        'No `from` address — pass `from` per call or set `defaultFrom` on the adapter.',
      )
    }

    const replyTo = notification.replyTo ?? this._defaultReplyTo

    // Per the framework plan, idempotency_key is forwarded as the
    // `Idempotency-Key` HTTP header. Resend's docs document that header
    // name directly, so this is the canonical mapping.
    const headers: Record<string, string> = { ...(notification.headers ?? {}) }
    if (notification.idempotency_key) {
      headers['Idempotency-Key'] = notification.idempotency_key
    }

    // Build the SDK payload. The Resend SDK's CreateEmailOptions is a
    // discriminated union (react|html|text RequireAtLeastOne) — we provide
    // html and/or text, never react.
    // biome-ignore lint/suspicious/noExplicitAny: Resend's discriminated union doesn't narrow well from optional fields
    const payload: any = {
      from,
      to: notification.to,
      subject: notification.subject,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      tags: notification.tags,
      replyTo,
    }
    if (notification.html) payload.html = notification.html
    if (notification.text) payload.text = notification.text

    let response: Awaited<ReturnType<typeof this._client.emails.send>>
    try {
      response = await this._client.emails.send(payload)
    } catch (err) {
      // Network/transport errors — let the workflow runner decide retry.
      throw new MantaError('UNEXPECTED_STATE', `Resend transport error: ${(err as Error).message}`)
    }

    if (response.error) {
      // 4xx-class provider failures (invalid_from_address, validation_error,
      // rate_limit_exceeded, ...). Surface as FAILURE so per-cart loops keep
      // going; the caller decides whether to mark or retry.
      const e = response.error
      return {
        status: 'FAILURE',
        error: new Error(`[${e.name ?? 'resend_error'}] ${e.message ?? 'Unknown Resend error'}`),
      }
    }

    return { status: 'SUCCESS', id: response.data?.id }
  }
}
