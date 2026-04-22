// WorkflowStatus — generic viewer for a workflow run.
// See WORKFLOW_PROGRESS.md §8 (dashboard run viewer).
//
// Consumes `useCommand('*', { runId })` in read-only polling mode, plus the
// cached snapshot (via React-Query's cache) to surface command_name and the
// overall workflow envelope.

import type { ProgressSnapshot, StepState, StepStatus, WorkflowRunSnapshot } from '@manta/sdk'
import { useCommand } from '@manta/sdk'
import { Badge, Button, cn, Progress } from '@manta/ui'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, CircleDashed, Loader2, MinusCircle, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export interface WorkflowStatusProps {
  runId: string
  /** Display override — otherwise the polled `command_name` is shown. */
  commandName?: string
  onComplete?: (result: unknown) => void
  onCancel?: () => void
  className?: string
}

// ── Sub-renderers (pure, testable without DOM) ─────────

/** Icon for a step status. Exposed for unit tests. */
export function stepStatusIcon(status: StepStatus) {
  switch (status) {
    case 'pending':
      return <CircleDashed className="h-4 w-4 text-muted-foreground" />
    case 'running':
      return <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
    case 'succeeded':
      return <CheckCircle2 className="h-4 w-4 text-green-600" />
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-600" />
    case 'cancelled':
      return <MinusCircle className="h-4 w-4 text-muted-foreground" />
    case 'compensated':
      return <AlertCircle className="h-4 w-4 text-orange-600" />
    default:
      return <CircleDashed className="h-4 w-4 text-muted-foreground" />
  }
}

/**
 * Compute progress-bar percentage. Exposed for unit tests.
 * Returns `null` when indeterminate (total unknown or non-positive).
 */
export function progressPercentage(current: number, total: number | null): number | null {
  if (total == null || total <= 0) return null
  if (current <= 0) return 0
  if (current >= total) return 100
  return Math.round((current / total) * 100)
}

/** Badge variant for an overall workflow status. Exposed for unit tests. */
export function statusBadgeVariant(status: string): 'green' | 'red' | 'blue' | 'orange' | 'grey' {
  switch (status) {
    case 'succeeded':
      return 'green'
    case 'failed':
      return 'red'
    case 'running':
      return 'blue'
    case 'cancelled':
      return 'orange'
    default:
      return 'grey'
  }
}

function formatTime(iso?: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

// ── Step timeline ──────────────────────────────────────

interface StepTimelineProps {
  steps: StepState[]
}

export function StepTimeline({ steps }: StepTimelineProps) {
  if (!steps || steps.length === 0) {
    return <p className="text-sm text-muted-foreground">En attente de démarrage…</p>
  }
  return (
    <ol className="flex flex-col gap-y-3">
      {steps.map((s) => (
        <li key={s.name} className="flex items-start gap-x-3">
          <div className="mt-0.5">{stepStatusIcon(s.status)}</div>
          <div className="flex flex-col gap-y-0.5">
            <div className="flex items-center gap-x-2">
              <span className="text-sm font-medium">{s.name}</span>
              <span className="text-xs text-muted-foreground">({s.status})</span>
            </div>
            {(s.started_at || s.completed_at) && (
              <div className="text-xs text-muted-foreground">
                {s.started_at && `démarré ${formatTime(s.started_at)}`}
                {s.started_at && s.completed_at && ' — '}
                {s.completed_at && `terminé ${formatTime(s.completed_at)}`}
              </div>
            )}
            {s.error && <div className="text-xs text-red-600">{s.error.message}</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}

// ── Progress bar ───────────────────────────────────────

interface ProgressPanelProps {
  progress: ProgressSnapshot
}

export function ProgressPanel({ progress }: ProgressPanelProps) {
  const pct = progressPercentage(progress.current, progress.total)
  if (pct == null) {
    return (
      <div className="flex items-center gap-x-2">
        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
        <span className="text-sm text-muted-foreground">{progress.message ?? `${progress.current} traités`}</span>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{progress.message ?? `${progress.current}/${progress.total}`}</span>
        <span>{pct}%</span>
      </div>
      <Progress value={pct} />
    </div>
  )
}

// ── Error panel ────────────────────────────────────────

interface ErrorPanelProps {
  message: string
  code?: string
  stack?: string
}

export function ErrorPanel({ message, code, stack }: ErrorPanelProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-destructive bg-destructive/10 p-3">
      <div className="flex items-start gap-x-2">
        <XCircle className="h-4 w-4 shrink-0 text-destructive" />
        <div className="flex flex-col gap-y-1">
          <div className="text-sm font-medium text-destructive">{message}</div>
          {code && <div className="text-xs text-muted-foreground">code: {code}</div>}
          {stack && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="text-xs text-muted-foreground underline"
            >
              {open ? 'Masquer la stack' : 'Afficher la stack'}
            </button>
          )}
          {open && stack && (
            <pre className="mt-1 max-h-60 overflow-auto rounded bg-background p-2 text-xs text-muted-foreground">
              {stack}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Result preview ─────────────────────────────────────

interface ResultPreviewProps {
  result: unknown
}

export function ResultPreview({ result }: ResultPreviewProps) {
  const [open, setOpen] = useState(false)
  let json = ''
  try {
    json = JSON.stringify(result, null, 2)
  } catch {
    json = String(result)
  }
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-x-2">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <span className="text-sm font-medium">Terminé</span>
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs text-muted-foreground underline">
          {open ? 'Masquer le résultat' : 'Afficher le résultat'}
        </button>
      </div>
      {open && (
        <pre className="mt-2 max-h-80 overflow-auto rounded bg-background p-2 text-xs text-muted-foreground">
          {json}
        </pre>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────

export function WorkflowStatus({ runId, commandName, onComplete, onCancel, className }: WorkflowStatusProps) {
  const cmd = useCommand(runId, { runId })
  const queryClient = useQueryClient()

  // Read the cached snapshot to access command_name + envelope fields not
  // surfaced by useCommand (run-level metadata).
  const snapshot = queryClient.getQueryData<WorkflowRunSnapshot>(['manta', 'workflow-run', runId])

  const displayName = commandName ?? snapshot?.command_name ?? runId

  // Fire onComplete/onCancel when status transitions to a terminal state.
  const lastStatusRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const prev = lastStatusRef.current
    lastStatusRef.current = cmd.status
    if (prev === cmd.status) return
    if (cmd.status === 'succeeded' && onComplete) onComplete(cmd.result)
    if (cmd.status === 'cancelled' && onCancel) onCancel()
  }, [cmd.status, cmd.result, onComplete, onCancel])

  const steps = cmd.steps ?? snapshot?.steps ?? []
  const progress = cmd.progress ?? snapshot?.inFlightProgress
  const isRunning = cmd.status === 'running'
  const isFailed = cmd.status === 'failed'
  const isSucceeded = cmd.status === 'succeeded'

  const errorObj = isFailed
    ? ((cmd.error as { message?: string; code?: string; stack?: string } | undefined) ?? snapshot?.error)
    : undefined

  return (
    <div className={cn('flex flex-col gap-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-y-1">
          <div className="flex items-center gap-x-2">
            <span className="text-lg font-semibold">{displayName}</span>
            <Badge variant={statusBadgeVariant(cmd.status)}>{cmd.status}</Badge>
          </div>
          <span className="text-xs text-muted-foreground">run {runId}</span>
        </div>
        {isRunning && (
          <Button
            size="small"
            variant={'destructive' as never}
            onClick={() => {
              void cmd.cancel()
            }}
          >
            Annuler
          </Button>
        )}
      </div>

      {/* Live progress for the running step */}
      {isRunning && progress && <ProgressPanel progress={progress} />}

      {/* Step timeline */}
      <div className="rounded-md border border-border p-4">
        <StepTimeline steps={steps} />
      </div>

      {/* Error panel */}
      {isFailed && errorObj && (
        <ErrorPanel message={errorObj.message ?? 'Erreur inconnue'} code={errorObj.code} stack={errorObj.stack} />
      )}

      {/* Result preview */}
      {isSucceeded && cmd.result !== undefined && <ResultPreview result={cmd.result} />}
    </div>
  )
}
