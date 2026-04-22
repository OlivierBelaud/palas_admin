// InMemoryQueueAdapter — dev / test IQueuePort implementation.
//
// Delivers messages via `setImmediate(() => fetch(url, { method: 'POST', body }))`
// in the same Node process. Sufficient for local `pnpm dev` where the dev
// server and the lambda handler share a process. Loses messages on process
// death — use `@manta/adapter-queue-qstash` (or a similar durable queue) for
// production.
//
// Idempotency: keeps a small in-memory LRU of recently-delivered keys so
// duplicate enqueues (e.g. a step that throws mid-retry) don't deliver
// twice within the same process. Best-effort; not a substitute for the
// durable dedupe a real queue provides.

import type { IQueuePort, QueueMessage } from './queue'

const RECENT_KEYS_MAX = 1000

export interface InMemoryQueueAdapterOptions {
  /**
   * Extra headers to add to every POST — typically an internal auth header
   * the resume route trusts (so end users can't spam /_workflow/:id/resume).
   */
  headers?: Record<string, string>
  /** fetch implementation override — for tests. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch
  /** Logger for delivery failures. */
  logger?: { warn: (msg: string) => void; error?: (msg: string, err?: unknown) => void }
}

export class InMemoryQueueAdapter implements IQueuePort {
  private _recent = new Set<string>()
  private _headers: Record<string, string>
  private _fetch: typeof globalThis.fetch
  private _logger: InMemoryQueueAdapterOptions['logger']

  constructor(opts: InMemoryQueueAdapterOptions = {}) {
    this._headers = opts.headers ?? {}
    this._fetch = opts.fetch ?? globalThis.fetch
    this._logger = opts.logger
  }

  async enqueue(message: QueueMessage): Promise<void> {
    if (message.idempotencyKey) {
      if (this._recent.has(message.idempotencyKey)) return
      this._recent.add(message.idempotencyKey)
      if (this._recent.size > RECENT_KEYS_MAX) {
        // Evict oldest — Set iteration is insertion order so pop the first one.
        const first = this._recent.values().next().value
        if (first !== undefined) this._recent.delete(first)
      }
    }
    const delay = Math.max(0, message.delayMs ?? 0)
    const deliver = async () => {
      try {
        const res = await this._fetch(message.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this._headers },
          body: JSON.stringify(message.payload ?? {}),
        })
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          this._logger?.warn?.(
            `[InMemoryQueueAdapter] delivery ${res.status} for ${message.url}: ${body.slice(0, 200)}`,
          )
        }
      } catch (err) {
        this._logger?.error?.(`[InMemoryQueueAdapter] delivery failed for ${message.url}`, err)
      }
    }
    if (delay > 0) {
      setTimeout(deliver, delay)
    } else {
      // setImmediate so the enqueue returns before the POST fires — matches
      // real queue semantics where enqueue is decoupled from delivery.
      setImmediate(deliver)
    }
  }
}
