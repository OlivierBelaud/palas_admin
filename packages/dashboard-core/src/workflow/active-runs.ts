// active-runs — sessionStorage-backed registry of in-flight workflow runs.
// Used by <ActiveRunsBridge /> to resurrect persistent toasts after
// navigation/reload, when the user is still on the page that started the run.
//
// SSR-safe: every op guards `typeof window !== 'undefined'`.

export interface ActiveRun {
  runId: string
  commandName: string
  commandLabel?: string
  originPath: string
  detailPath: string
  startedAt: number
}

const STORAGE_KEY = 'manta.activeRuns'

type Listener = (runs: ActiveRun[]) => void
const listeners = new Set<Listener>()

function readStorage(): ActiveRun[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as ActiveRun[]
  } catch (err) {
    console.error('[WorkflowToast] active-runs: failed to parse sessionStorage', err)
    return []
  }
}

function writeStorage(runs: ActiveRun[]): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(runs))
  } catch (err) {
    console.error('[WorkflowToast] active-runs: failed to write sessionStorage', err)
  }
}

function notify(runs: ActiveRun[]): void {
  for (const fn of listeners) {
    try {
      fn(runs)
    } catch (err) {
      console.error('[WorkflowToast] active-runs: listener threw', err)
    }
  }
}

export function list(): ActiveRun[] {
  return readStorage()
}

export function has(runId: string): boolean {
  return readStorage().some((r) => r.runId === runId)
}

export function add(run: ActiveRun): void {
  const current = readStorage()
  if (current.some((r) => r.runId === run.runId)) return
  const next = [...current, run]
  writeStorage(next)
  notify(next)
}

export function remove(runId: string): void {
  const current = readStorage()
  const next = current.filter((r) => r.runId !== runId)
  if (next.length === current.length) return
  writeStorage(next)
  notify(next)
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
