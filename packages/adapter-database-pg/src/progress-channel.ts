// DbProgressChannel — Postgres fallback for workflow progress liveness.
// Implements IProgressChannelPort — see WORKFLOW_PROGRESS.md §9.2.
//
// Used when no Upstash cache is configured. Sub-ms latency is impossible on
// Postgres, so the adapter throttles writes at 500ms per runId (§9.2 table).
// `set()` is fire-and-forget and MUST NOT throw (§10.2 invariant #2).

import type { ILoggerPort, IProgressChannelPort, ProgressSnapshot } from '@manta/core'
import { workflowProgress } from '@manta/core/db'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

const THROTTLE_MS = 500

/**
 * Progress channel backed by Postgres (Drizzle).
 *
 * Throttles DB writes per-runId: the first `set()` flushes immediately; further
 * calls within 500ms are coalesced and flushed once the window elapses. The
 * latest snapshot always wins.
 *
 * @example
 * const channel = new DbProgressChannel(drizzleDb, { logger })
 */
export class DbProgressChannel implements IProgressChannelPort {
  private _lastWriteAt = new Map<string, number>()
  private _pending = new Map<string, ProgressSnapshot>()
  private _timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private _db: PostgresJsDatabase,
    private _deps: { logger?: ILoggerPort } = {},
  ) {}

  async set(runId: string, snapshot: ProgressSnapshot): Promise<void> {
    const now = Date.now()
    const last = this._lastWriteAt.get(runId) ?? 0
    const elapsed = now - last

    if (elapsed >= THROTTLE_MS) {
      this._lastWriteAt.set(runId, now)
      // Fire-and-forget: do not await.
      void this._flush(runId, snapshot)
      return
    }

    // Within throttle window — buffer the latest snapshot, schedule a flush
    // if one isn't already pending.
    this._pending.set(runId, snapshot)
    if (this._timers.has(runId)) return

    const delay = THROTTLE_MS - elapsed
    const timer = setTimeout(() => {
      this._timers.delete(runId)
      const latest = this._pending.get(runId)
      if (!latest) return
      this._pending.delete(runId)
      this._lastWriteAt.set(runId, Date.now())
      void this._flush(runId, latest)
    }, delay)
    this._timers.set(runId, timer)
  }

  async get(runId: string): Promise<ProgressSnapshot | null> {
    const rows = await this._db.select().from(workflowProgress).where(eq(workflowProgress.run_id, runId)).limit(1)
    if (rows.length === 0) return null
    const row = rows[0]
    return {
      stepName: row.step_name,
      current: row.current,
      total: row.total ?? null,
      message: row.message ?? undefined,
      at: row.at_ms,
    }
  }

  async clear(runId: string): Promise<void> {
    const timer = this._timers.get(runId)
    if (timer) {
      clearTimeout(timer)
      this._timers.delete(runId)
    }
    this._pending.delete(runId)
    this._lastWriteAt.delete(runId)

    await this._db.delete(workflowProgress).where(eq(workflowProgress.run_id, runId))
  }

  private async _flush(runId: string, snapshot: ProgressSnapshot): Promise<void> {
    try {
      await this._db
        .insert(workflowProgress)
        .values({
          run_id: runId,
          step_name: snapshot.stepName,
          current: snapshot.current,
          total: snapshot.total ?? null,
          message: snapshot.message ?? null,
          at_ms: snapshot.at,
        })
        .onConflictDoUpdate({
          target: workflowProgress.run_id,
          set: {
            step_name: snapshot.stepName,
            current: snapshot.current,
            total: snapshot.total ?? null,
            message: snapshot.message ?? null,
            at_ms: snapshot.at,
          },
        })
    } catch (err) {
      // Invariant #2: never throw from set(). Log and swallow.
      this._deps.logger?.warn('progress write failed', { err, runId, stepName: snapshot.stepName })
    }
  }
}
