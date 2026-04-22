// useResurrectActiveRuns — re-emits a persistent toast for every activeRun
// whose originPath matches the current pathname. Sonner dedupes by `id`, so
// resurrecting a run that already has a visible toast is a no-op.

import { toast } from '@manta/ui'
import { createElement, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import * as activeRuns from './active-runs'
import { WorkflowToast } from './workflow-toast'

/**
 * Pure, testable: re-emit `toast.custom` for each activeRun whose `originPath`
 * equals `pathname`. Exact match (no prefix), no query-string/hash consideration.
 */
export function resurrectForPath(pathname: string): void {
  const runs = activeRuns.list()
  for (const r of runs) {
    if (r.originPath !== pathname) continue
    toast.custom(
      (t) =>
        createElement(WorkflowToast, {
          toastId: t,
          runId: r.runId,
          commandName: r.commandName,
          commandLabel: r.commandLabel,
          detailPath: r.detailPath,
        }),
      {
        id: `workflow-run-${r.runId}`,
        duration: Number.POSITIVE_INFINITY,
        dismissible: false,
      },
    )
  }
}

export function useResurrectActiveRuns(): void {
  const location = useLocation()
  useEffect(() => {
    resurrectForPath(location.pathname)
  }, [location.pathname])
}
