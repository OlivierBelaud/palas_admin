// IProgressChannelPort — ephemeral liveness channel for workflow step progress.
// Separate from IWorkflowStorePort (durable) so `ctx.progress()` has sub-ms cost.
// See WORKFLOW_PROGRESS.md §3 (durability vs liveness), §5.2 (snapshot shape),
// §9.2 (three adapters), §10.2 (fire-and-forget invariants).

/**
 * One-shot progress snapshot written by a running step.
 * Latest snapshot overrides the previous — no history is retained.
 */
export interface ProgressSnapshot {
  /** Name of the step that produced this snapshot. */
  stepName: string
  /** Current progress count (e.g. items processed). */
  current: number
  /** Total expected count. `null` for unbounded AsyncIterable streams. */
  total: number | null
  /** Optional human-readable status message. */
  message?: string
  /** Epoch milliseconds when the snapshot was produced. */
  at: number
}

/**
 * Ephemeral progress channel contract.
 *
 * Adapters: UpstashProgressChannel (default), DbProgressChannel (fallback when
 * no cache is configured), InMemoryProgressChannel (test containers).
 *
 * Invariants (see WORKFLOW_PROGRESS.md §10.2):
 * 1. `set()` is fire-and-forget — callers never await the network/IO.
 * 2. `set()` never throws — channel errors are logged, not propagated.
 * 3. No throttle at the call site — the adapter copes (Upstash handles volume
 *    trivially; the DB fallback throttles internally).
 */
export interface IProgressChannelPort {
  /**
   * Write the latest snapshot for a run. Overrides any previous snapshot.
   * MUST NOT throw — errors are logged and swallowed.
   */
  set(runId: string, snapshot: ProgressSnapshot): Promise<void>

  /**
   * Read the latest snapshot for a run, or `null` if none / expired.
   * Called from the `/_workflow/:id` read path — MAY throw.
   */
  get(runId: string): Promise<ProgressSnapshot | null>

  /**
   * Clear the snapshot for a run (e.g. on workflow completion).
   * Called from the engine cleanup path — MAY throw.
   */
  clear(runId: string): Promise<void>
}
