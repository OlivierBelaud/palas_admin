// WP-F04 — Orphan reaper job.
//
// On serverless hosts (Vercel), a workflow that takes longer than the HTTP
// invocation it started in has no way to continue running — the function is
// killed when the handler returns. `workflow_runs.status` stays 'running'
// forever unless something reaps it.
//
// This module produces a framework-owned job that the bootstrap registers
// against IJobSchedulerPort when both the scheduler AND IWorkflowStorePort
// are wired. The job scans for runs whose heartbeat_at is older than the
// configured threshold and marks them failed. V1 does NOT resume the run —
// it just flags the failure so the UI stops spinning. Resume is a separate,
// larger feature (would need driver wake-up + re-entry into WorkflowManager).

import type { ILoggerPort } from '../ports/logger'
import type { JobResult } from '../ports/types'
import type { IWorkflowStorePort } from '../ports/workflow-store'

/** Default threshold — 5 minutes without a heartbeat = orphan. */
export const DEFAULT_ORPHAN_THRESHOLD_MS = 5 * 60 * 1000

/** Default max orphans reaped per tick. */
export const DEFAULT_ORPHAN_REAP_LIMIT = 50

/** Framework-owned job name. Prefixed with `__manta_` so it cannot collide with user jobs. */
export const ORPHAN_REAPER_JOB_NAME = '__manta_workflow_orphan_reaper'

/** Default schedule — every minute. */
export const ORPHAN_REAPER_SCHEDULE = '*/1 * * * *'

/** Stable error code written into workflow_runs.error when a run is reaped. */
export const WORKFLOW_ORPHANED_CODE = 'WORKFLOW_ORPHANED'

export interface OrphanReaperOptions {
  /** How long without a heartbeat before a run is considered orphaned. Defaults to 5 minutes. */
  orphanThresholdMs?: number
  /** Max number of orphans reaped per tick. Defaults to 50. */
  limit?: number
}

export interface OrphanReaperResult extends JobResult {
  status: 'success'
  data: { reaped: number; total: number }
  duration_ms: number
}

/**
 * Descriptor returned by `createOrphanReaperJob`. The bootstrap phase passes
 * these fields straight into `IJobSchedulerPort.register(name, schedule, handler)`.
 */
export interface OrphanReaperJobDescriptor {
  name: string
  schedule: string
  /** Closure over the store + logger — the scheduler calls this on each tick. */
  handler: () => Promise<OrphanReaperResult>
}

/**
 * Build the orphan reaper job descriptor.
 *
 * The returned handler is a plain closure — it does NOT rely on `ctx.app`
 * (the scheduler's `setApp()` is not wired from bootstrap today, so resolving
 * via the app would be flaky). Instead it closes over the store + logger
 * directly, mirroring the pattern used for user jobs in load-resources.ts.
 */
export function createOrphanReaperJob(
  deps: { store: IWorkflowStorePort; logger: ILoggerPort },
  options: OrphanReaperOptions = {},
): OrphanReaperJobDescriptor {
  const thresholdMs = options.orphanThresholdMs ?? DEFAULT_ORPHAN_THRESHOLD_MS
  const limit = options.limit ?? DEFAULT_ORPHAN_REAP_LIMIT
  const { store, logger } = deps

  return {
    name: ORPHAN_REAPER_JOB_NAME,
    schedule: ORPHAN_REAPER_SCHEDULE,
    handler: async (): Promise<OrphanReaperResult> => {
      const startMs = Date.now()
      const cutoff = new Date(startMs - thresholdMs)
      const orphans = await store.listOrphans({ olderThan: cutoff, limit })

      if (orphans.length === 0) {
        return { status: 'success', data: { reaped: 0, total: 0 }, duration_ms: Date.now() - startMs }
      }

      let reaped = 0
      for (const orphan of orphans) {
        try {
          await store.markOrphanFailed(orphan.id, {
            message: `Workflow orphaned — no heartbeat for ${Math.round(thresholdMs / 1000)}s`,
            code: WORKFLOW_ORPHANED_CODE,
          })
          reaped++
        } catch (err) {
          // Never throw from the reaper. One bad orphan must not break the job.
          logger.warn(`Failed to mark orphan as failed (runId=${orphan.id})`, err)
        }
      }

      logger.info(`Orphan reaper completed (reaped=${reaped}, total=${orphans.length})`)
      return {
        status: 'success',
        data: { reaped, total: orphans.length },
        duration_ms: Date.now() - startMs,
      }
    },
  }
}
