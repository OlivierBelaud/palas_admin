// QStashQueueAdapter — IQueuePort backed by Upstash QStash (HTTP scheduler).
//
// QStash accepts a publish request (`POST {QSTASH_URL}/v2/publish/{dest}`)
// and calls `dest` later with our payload as the POST body. It handles
// retries (up to 3 by default), signed headers (HMAC-SHA256 over the body),
// and delivery to internet-reachable URLs.
//
// Auth: `Authorization: Bearer $QSTASH_TOKEN` on the publish request.
// Delivery headers on the receiving endpoint include
// `Upstash-Signature` — verify with `@upstash/qstash` SDK or the
// receiver-side `verifyQStashSignature` helper in this package.
//
// Free tier: 500 msg/day, enough for a rebuild button.

import type { IQueuePort, QueueMessage } from '@manta/core'

export interface QStashQueueAdapterOptions {
  /** Upstash QStash REST endpoint, e.g. `https://qstash-eu-central-1.upstash.io`. */
  url: string
  /** Upstash QStash publish token (`QSTASH_TOKEN`). */
  token: string
  /** Request timeout in ms (default 5s). */
  timeoutMs?: number
  /** fetch override, for tests. */
  fetch?: typeof globalThis.fetch
  /** Optional logger for delivery errors. */
  logger?: { warn: (msg: string) => void; error?: (msg: string, err?: unknown) => void }
}

export class QStashQueueAdapter implements IQueuePort {
  private _url: string
  private _token: string
  private _timeoutMs: number
  private _fetch: typeof globalThis.fetch
  private _logger: QStashQueueAdapterOptions['logger']

  constructor(opts: QStashQueueAdapterOptions) {
    this._url = opts.url.replace(/\/+$/, '')
    this._token = opts.token
    this._timeoutMs = opts.timeoutMs ?? 5_000
    this._fetch = opts.fetch ?? globalThis.fetch
    this._logger = opts.logger
  }

  async enqueue(message: QueueMessage): Promise<void> {
    const target = `${this._url}/v2/publish/${encodeURIComponent(message.url)}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this._token}`,
      'Content-Type': 'application/json',
    }
    if (message.delayMs && message.delayMs > 0) {
      headers['Upstash-Delay'] = `${Math.ceil(message.delayMs / 1000)}s`
    }
    if (message.idempotencyKey) {
      // QStash doesn't have native idempotency on publish but accepts a
      // custom `Upstash-Deduplication-Id` header on some plans; always include
      // it — backend ignores it if unsupported.
      headers['Upstash-Deduplication-Id'] = message.idempotencyKey
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this._timeoutMs)
    try {
      const res = await this._fetch(target, {
        method: 'POST',
        headers,
        body: JSON.stringify(message.payload ?? {}),
        signal: controller.signal,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const msg = `[QStashQueueAdapter] publish ${res.status} for ${message.url}: ${body.slice(0, 200)}`
        this._logger?.warn?.(msg)
        throw new Error(msg)
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
