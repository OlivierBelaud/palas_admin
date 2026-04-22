// WorkflowToast — persistent sonner toast that observes a workflow run via
// useCommand(runId, { runId }) and emits a completion toast on terminal states.
// Internal — always mounted via toastWorkflowRun().

import { useCommand } from '@manta/sdk'
import { Button, Progress, toast } from '@manta/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import * as activeRuns from './active-runs'

export interface WorkflowToastProps {
  toastId: number | string
  runId: string
  commandName: string
  commandLabel?: string
  detailPath: string
  /** Refetch all React Query cache entries on terminal success. Default: true. */
  invalidateOnSuccess?: boolean
}

const ORPHAN_THRESHOLD = 5

export function WorkflowToast({
  toastId,
  runId,
  commandName,
  commandLabel,
  detailPath,
  invalidateOnSuccess = true,
}: WorkflowToastProps) {
  const cmd = useCommand(runId, { runId })
  const queryClient = useQueryClient()
  const emittedRef = useRef(false)
  const errorCountRef = useRef(0)

  const title = commandLabel ?? commandName

  // Terminal-status effect: dismiss + remove + emit completion toast, once.
  useEffect(() => {
    if (emittedRef.current) return
    const s = cmd.status
    if (s !== 'succeeded' && s !== 'failed' && s !== 'cancelled') return
    emittedRef.current = true
    toast.dismiss(toastId)
    activeRuns.remove(runId)
    if (s === 'succeeded') {
      // Refresh the current page's data without a hard refresh — invalidates
      // every React Query in the cache so DataList/DataTable/InfoCard hooks
      // re-fetch on their next render.
      if (invalidateOnSuccess) queryClient.invalidateQueries()
      toast.success(`${title} — terminé`, { duration: 4000 })
    } else if (s === 'failed') {
      const errMsg = (cmd.error as { message?: string } | undefined)?.message
      toast.error(`${title} — échec`, { duration: 10000, description: errMsg })
    } else {
      toast.message(`${title} — annulé`, { duration: 4000 })
    }
  }, [cmd.status, cmd.error, toastId, runId, title, invalidateOnSuccess, queryClient])

  // Orphan dismissal: N consecutive polling errors → assume the run no longer
  // exists on the server. Increments only when cmd.error identity changes
  // (once per polling cycle), not on every re-render.
  useEffect(() => {
    if (emittedRef.current) return
    if (cmd.error) {
      errorCountRef.current += 1
      if (errorCountRef.current >= ORPHAN_THRESHOLD) {
        emittedRef.current = true
        toast.dismiss(toastId)
        activeRuns.remove(runId)
        toast.message('Exécution introuvable', { duration: 4000 })
      }
    } else {
      errorCountRef.current = 0
    }
  }, [cmd.error, toastId, runId])

  const progress = cmd.progress
  const pct =
    progress?.total && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : undefined
  const progressLine =
    progress?.total && progress.total > 0
      ? `${progress.current}/${progress.total}${pct !== undefined ? ` (${pct}%)` : ''}`
      : (progress?.message ?? 'En cours…')

  return (
    <div className="flex w-full items-center gap-x-3 rounded-md border border-border bg-background p-3 shadow-lg">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
      <div className="flex min-w-0 flex-1 flex-col gap-y-0.5">
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{progressLine}</span>
        {pct !== undefined ? <Progress value={pct} className="h-1.5" /> : null}
      </div>
      <div className="flex shrink-0 items-center gap-x-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void cmd.cancel()
          }}
        >
          Annuler
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            // Toasts render in a Sonner portal OUTSIDE the <Router> tree, so
            // useNavigate() cannot be used here. window.location is safe — the
            // SPA router picks up the path on navigation.
            window.location.assign(detailPath)
          }}
        >
          Détails
        </Button>
      </div>
    </div>
  )
}
