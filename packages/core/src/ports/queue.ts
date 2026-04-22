// IQueuePort — pluggable job scheduler used by WorkflowManager for
// serverless continuations (WORKFLOW_PROGRESS.md addendum — yield primitive).
//
// When a step throws WorkflowYield, the manager persists its `resumeState`,
// marks the run `paused`, and asks the configured IQueuePort to enqueue a
// POST to the resume endpoint. The queue delivers that request in a fresh
// serverless invocation, which calls `manager.resume(runId)` to continue.
//
// Adapters:
//   - `InMemoryQueueAdapter` (in @manta/core) — test / dev, uses setImmediate +
//     direct HTTP fetch to self. Loses messages on process death.
//   - `@manta/adapter-queue-qstash` — production. Upstash QStash HTTP scheduler,
//     durable, retry-safe, free tier 500 msg/day.

export interface QueueMessage {
  /** Target URL the queue should POST to deliver this message. */
  url: string
  /** JSON-serializable payload. Delivered as the POST body. */
  payload: unknown
  /**
   * Delay in milliseconds before delivery. 0 = deliver as soon as possible.
   * Adapters MAY round up to their minimum granularity.
   */
  delayMs?: number
  /**
   * Optional idempotency key. Adapters SHOULD deduplicate on this key so a
   * retried enqueue does not produce multiple deliveries. WorkflowManager
   * passes `resume:<runId>` so a crashed enqueue can be safely retried.
   */
  idempotencyKey?: string
}

export interface IQueuePort {
  enqueue(message: QueueMessage): Promise<void>
}
