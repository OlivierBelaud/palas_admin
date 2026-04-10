// Manta SDK — React hooks for CQRS endpoints
// useCommand, useQuery, useGraphQuery

import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery as useReactQuery,
} from '@tanstack/react-query'
import type { GraphQueryInput } from './client'
import { useMantaClient } from './provider'

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

/**
 * Execute a command (mutation).
 * Autocompletes command names from codegen.
 *
 * @example
 * ```tsx
 * const createProduct = useCommand('create-product')
 *
 * // Execute
 * await createProduct.mutateAsync({ title: 'Widget', sku: 'W-001', price: 99 })
 *
 * // Or with onClick
 * <button onClick={() => createProduct.mutate({ title: 'Widget' })}>Create</button>
 * ```
 */
export function useCommand<TInput = unknown, TOutput = unknown>(
  name: CommandName,
): UseMutationResult<TOutput, Error, TInput> {
  const client = useMantaClient()
  return useMutation<TOutput, Error, TInput>({
    mutationKey: ['manta', 'command', name],
    mutationFn: (input: TInput) => client.command<TInput, TOutput>(name, input),
  })
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
  return useReactQuery<TOutput, Error>({
    queryKey: ['manta', 'query', name, params],
    queryFn: () => client.query<TOutput>(name, params),
    enabled: options?.enabled,
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
