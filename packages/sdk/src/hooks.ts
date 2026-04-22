// Manta SDK — React hooks for CQRS endpoints
// useCommand, useQuery, useGraphQuery

import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery as useReactQuery,
} from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GraphQueryInput, MantaSDKError } from './client'
import { useMantaClient } from './provider'
import {
  isTerminalStatus,
  type ProgressSnapshot,
  type RunResult,
  type StepState,
  type UseCommandResult,
  type UseCommandStatus,
  type WorkflowError,
  type WorkflowRunSnapshot,
} from './workflow-types'

// ── Types for autocomplete ─────────────────────────────
// These are augmented by codegen (.manta/generated.d.ts)
// When codegen runs, MantaGeneratedCommands provides autocomplete for command names.
// When codegen hasn't run, any string is accepted.

declare global {
  interface MantaGeneratedCommands {}
  interface MantaGeneratedQueries {}
}

type CommandName = keyof MantaGeneratedCommands extends never ? string : keyof MantaGeneratedCommands | (string & {})
type QueryName = keyof MantaGeneratedQueries extends never ? string : keyof MantaGeneratedQueries | (string & {})

// ── useCommand ─────────────────────────────────────────

export const WORKFLOW_POLL_INTERVAL_MS = 1000

/** Internal hook state — exported for unit testing of the pure reducers below. */
export interface CommandState<TOutput> {
  status: UseCommandStatus
  runId: string | undefined
  steps: StepState[] | undefined
  progress: ProgressSnapshot | undefined
  result: TOutput | undefined
  error: MantaSDKError | WorkflowError | undefined
}

export function idleState<TOutput>(): CommandState<TOutput> {
  return {
    status: 'idle',
    runId: undefined,
    steps: undefined,
    progress: undefined,
    result: undefined,
    error: undefined,
  }
}

export function readOnlyInitialState<TOutput>(runId: string): CommandState<TOutput> {
  return {
    status: 'running',
    runId,
    steps: undefined,
    progress: undefined,
    result: undefined,
    error: undefined,
  }
}

/**
 * Reducer: merge a polled WorkflowRunSnapshot into the previous hook state.
 * Pure — safe to call from tests or the React useEffect.
 */
export function mergePollSnapshot<TOutput>(
  prev: CommandState<TOutput>,
  snap: WorkflowRunSnapshot,
): CommandState<TOutput> {
  if (!prev.runId || prev.runId !== snap.id) return prev
  // Map WorkflowStatus → UseCommandStatus. `pending` (pre-run) is surfaced as
  // `running` since the hook is already past idle once we have a runId.
  const nextStatus: UseCommandStatus = snap.status === 'pending' ? 'running' : snap.status
  return {
    ...prev,
    status: nextStatus,
    steps: snap.steps,
    progress: snap.inFlightProgress ?? prev.progress,
    result: nextStatus === 'succeeded' ? (snap.output as TOutput) : prev.result,
    error: nextStatus === 'failed' ? snap.error : prev.error,
  }
}

/**
 * Reducer: derive the post-run() state from the HTTP envelope returned by
 * `MantaClient.runCommand()`. Pure — safe to call from tests.
 */
export function stateFromRunResult<TOutput>(envelope: RunResult<TOutput>): CommandState<TOutput> {
  if (envelope.status === 'succeeded') {
    return {
      status: 'succeeded',
      runId: envelope.runId,
      steps: undefined,
      progress: undefined,
      result: envelope.result,
      error: undefined,
    }
  }
  if (envelope.status === 'failed') {
    return {
      status: 'failed',
      runId: undefined,
      steps: undefined,
      progress: undefined,
      result: undefined,
      error: envelope.error,
    }
  }
  return {
    status: 'running',
    runId: envelope.runId,
    steps: undefined,
    progress: undefined,
    result: undefined,
    error: undefined,
  }
}

/**
 * Execute a command and observe its execution.
 *
 * See WORKFLOW_PROGRESS.md §7 for the full contract.
 *
 * Primary API:
 * ```tsx
 * const { run, runId, status, steps, progress, result, error, cancel } = useCommand('import-products')
 *
 * async function onClick() {
 *   const r = await run({ file })
 *   if (r.status === 'running') navigate(`/_runs/${r.runId}`)
 *   else if (r.status === 'succeeded') toast.success('Imported')
 *   else toast.error(r.error.message)
 * }
 * ```
 *
 * Read-only (observe an existing run):
 * ```tsx
 * const { status, steps, progress } = useCommand('import-products', { runId: 'abc-123' })
 * ```
 *
 * Back-compat aliases (`mutateAsync`, `mutate`, `isPending`, `isSuccess`, `isError`,
 * `reset`, `data`) preserve the old React-Query shape for existing call sites.
 */
export function useCommand<TInput = unknown, TOutput = unknown>(
  name: CommandName,
  options?: { runId?: string },
): UseCommandResult<TInput, TOutput> {
  const client = useMantaClient()
  const initialRunId = options?.runId
  const [state, setState] = useState<CommandState<TOutput>>(() =>
    initialRunId ? readOnlyInitialState<TOutput>(initialRunId) : idleState<TOutput>(),
  )

  // Keep the latest state in a ref so mutateAsync's effect can read it without
  // re-subscribing to every render.
  const stateRef = useRef(state)
  stateRef.current = state

  // Pending promise plumbing for mutateAsync's "await terminal" semantics is NOT
  // implemented here — per the PR-5 plan we take the simpler path: mutateAsync
  // awaits only the initial HTTP. For 'running' responses, it resolves with
  // `undefined` + a dev warning. See the JSDoc on UseCommandResult.mutateAsync.

  // ── Polling ─────────────────────────────────────────
  const shouldPoll = !!state.runId && !isTerminalStatus(state.status)
  const pollQuery = useReactQuery<WorkflowRunSnapshot, Error>({
    queryKey: ['manta', 'workflow-run', state.runId],
    queryFn: () => client.getWorkflowRun(state.runId as string),
    enabled: shouldPoll,
    refetchInterval: (query) => {
      const data = query.state.data as WorkflowRunSnapshot | undefined
      if (!data) return WORKFLOW_POLL_INTERVAL_MS
      return isTerminalStatus(data.status) ? false : WORKFLOW_POLL_INTERVAL_MS
    },
    refetchIntervalInBackground: false,
    retry: false,
  })

  // Merge polled snapshots into local state.
  useEffect(() => {
    const snap = pollQuery.data
    if (!snap) return
    setState((prev) => mergePollSnapshot<TOutput>(prev, snap))
  }, [pollQuery.data])

  // ── run ────────────────────────────────────────────
  const run = useCallback(
    async (input: TInput): Promise<RunResult<TOutput>> => {
      // Optimistic: flip to running with no runId so UI can show a spinner.
      setState({
        status: 'running',
        runId: undefined,
        steps: undefined,
        progress: undefined,
        result: undefined,
        error: undefined,
      })
      const envelope = await client.runCommand<TInput, TOutput>(name, input)
      setState(stateFromRunResult<TOutput>(envelope))
      return envelope
    },
    [client, name],
  )

  // ── cancel ─────────────────────────────────────────
  const cancel = useCallback(async () => {
    const current = stateRef.current
    if (!current.runId || isTerminalStatus(current.status)) return
    await client.cancelWorkflowRun(current.runId)
    // Polling continues — the server will report status: 'cancelled' and the
    // polling effect above will merge it into state.
  }, [client])

  // ── reset ──────────────────────────────────────────
  const reset = useCallback(() => {
    setState(idleState<TOutput>())
  }, [])

  // ── Back-compat aliases ────────────────────────────
  const mutateAsync = useCallback(
    async (input: TInput): Promise<TOutput | undefined> => {
      const r = await run(input)
      if (r.status === 'succeeded') return r.result
      if (r.status === 'failed') throw r.error
      // 'running' — mutateAsync historically returned the bare result. For
      // async workflows we can't deliver that without blocking on polling;
      // return undefined and warn so callers migrate to run() + runId.
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(
          `[useCommand] '${name}' returned async (runId=${r.runId}). mutateAsync resolved with undefined. ` +
            'Migrate to run() + runId to observe the workflow — see WORKFLOW_PROGRESS.md §7.',
        )
      }
      return undefined
    },
    [run, name],
  )

  const mutate = useCallback(
    (input: TInput) => {
      void run(input).catch(() => {
        /* fire-and-forget: error is stored in state.error */
      })
    },
    [run],
  )

  return {
    // Primary API
    run,
    runId: state.runId,
    status: state.status,
    steps: state.steps,
    progress: state.progress,
    result: state.result,
    error: state.error,
    cancel,
    // Back-compat aliases
    mutateAsync,
    mutate,
    isPending: state.status === 'running',
    isSuccess: state.status === 'succeeded',
    isError: state.status === 'failed',
    reset,
    data: state.result,
  }
}

// ── useQuery ───────────────────────────────────────────

/**
 * Execute a named query (read-only).
 * Queries are defined with defineQuery() on the backend.
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useQuery('list-products', { status: 'active', limit: 10 })
 *
 * if (isLoading) return <div>Loading...</div>
 * return <ul>{data?.map(p => <li key={p.id}>{p.title}</li>)}</ul>
 * ```
 */
export function useQuery<TOutput = unknown>(
  name: QueryName,
  params?: Record<string, unknown>,
  options?: { enabled?: boolean; staleTime?: number; refetchInterval?: number },
): UseQueryResult<TOutput, Error> {
  const client = useMantaClient()
  // Block queries with unresolved :param placeholders (e.g., id=":id" before useParams resolves)
  const hasUnresolved =
    params && Object.values(params).some((v) => typeof v === 'string' && (v as string).startsWith(':'))
  const enabled = (options?.enabled ?? true) && !hasUnresolved
  return useReactQuery<TOutput, Error>({
    queryKey: ['manta', 'query', name, params],
    queryFn: () => client.query<TOutput>(name, params),
    enabled,
    staleTime: options?.staleTime,
    refetchInterval: options?.refetchInterval,
  })
}

// ── useGraphQuery ──────────────────────────────────────

/**
 * Execute a graph query (flexible entity + relations + filters).
 * Only works if defineQueryGraph() is declared for the current context.
 *
 * @example
 * ```tsx
 * const { data } = useGraphQuery({
 *   entity: 'product',
 *   filters: { status: 'active' },
 *   relations: ['inventory_item'],
 *   pagination: { limit: 20 },
 * })
 * ```
 */
export function useGraphQuery<TOutput = unknown>(
  config: GraphQueryInput,
  options?: { enabled?: boolean; staleTime?: number; refetchInterval?: number },
): UseQueryResult<TOutput, Error> {
  const client = useMantaClient()
  return useReactQuery({
    queryKey: ['manta', 'graph', config.entity, config],
    queryFn: () => client.graphQuery<TOutput>(config),
    enabled: options?.enabled,
    staleTime: options?.staleTime,
    refetchInterval: options?.refetchInterval,
    placeholderData: ((prev: TOutput | undefined) => prev) as unknown as undefined,
  }) as unknown as UseQueryResult<TOutput, Error>
}

// ── useAuth ────────────────────────────────────────────

/**
 * Auth helpers for the current context.
 *
 * @example
 * ```tsx
 * const { login, logout, me } = useAuth()
 *
 * await login('admin@example.com', 'password')
 * const user = await me()
 * await logout()
 * ```
 */
export function useAuth() {
  const client = useMantaClient()

  const loginMutation = useMutation({
    mutationKey: ['manta', 'auth', 'login'],
    mutationFn: ({ email, password }: { email: string; password: string }) => client.login(email, password),
  })

  const logoutMutation = useMutation({
    mutationKey: ['manta', 'auth', 'logout'],
    mutationFn: () => client.logout(),
  })

  const meQuery = useReactQuery({
    queryKey: ['manta', 'auth', 'me'],
    queryFn: () => client.me(),
    retry: false,
  })

  return {
    login: (email: string, password: string) => loginMutation.mutateAsync({ email, password }),
    logout: () => logoutMutation.mutateAsync(),
    me: meQuery,
    isAuthenticated: !!meQuery.data && !meQuery.isError,
    isLoading: meQuery.isLoading,
  }
}

// Re-export UseMutationResult purely as a type for consumers that previously
// relied on the old useCommand return shape via `ReturnType<typeof useCommand>`.
// New code should use `UseCommandResult<TIn, TOut>` directly from workflow-types.
export type { UseMutationResult }
