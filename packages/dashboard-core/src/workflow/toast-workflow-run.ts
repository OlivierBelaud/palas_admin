// toastWorkflowRun — public helper: turn a runId into a persistent sonner toast.
// Registers the run in activeRuns (sessionStorage) so navigation does not drop it.

import { toast } from '@manta/ui'
import { createElement } from 'react'
import * as activeRuns from './active-runs'
import { WorkflowToast } from './workflow-toast'

export interface ToastWorkflowRunOptions {
  commandName: string
  commandLabel?: string
  originPath?: string
  detailPath?: string
  /**
   * On terminal success, invalidate the React Query cache so the current page
   * re-fetches its data without a hard refresh. Defaults to `true` — most
   * workflows mutate server data and the UI should reflect it immediately.
   * Set to `false` for read-only or analytics workflows.
   */
  invalidateOnSuccess?: boolean
}

export function toastWorkflowRun(runId: string, options: ToastWorkflowRunOptions): void {
  if (activeRuns.has(runId)) return

  const originPath = options.originPath ?? (typeof window !== 'undefined' ? window.location.pathname : '')
  // Derive SPA basename from originPath so '/admin/paniers' → '/admin/_runs/<id>'.
  // The toast renders in a Sonner portal OUTSIDE the Router → we can't rely on
  // React Router basename resolution for navigation. Preserve first path segment.
  const spaBase = originPath.split('/').filter(Boolean)[0] ?? ''
  const detailPath = options.detailPath ?? (spaBase ? `/${spaBase}/_runs/${runId}` : `/_runs/${runId}`)

  activeRuns.add({
    runId,
    commandName: options.commandName,
    commandLabel: options.commandLabel,
    originPath,
    detailPath,
    startedAt: Date.now(),
  })

  toast.custom(
    (t) =>
      createElement(WorkflowToast, {
        toastId: t,
        runId,
        commandName: options.commandName,
        commandLabel: options.commandLabel,
        detailPath,
        invalidateOnSuccess: options.invalidateOnSuccess ?? true,
      }),
    {
      id: `workflow-run-${runId}`,
      duration: Number.POSITIVE_INFINITY,
      dismissible: false,
    },
  )
}
