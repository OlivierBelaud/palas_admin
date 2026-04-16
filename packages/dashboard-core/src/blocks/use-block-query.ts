// Hook to fetch data for a block based on its query prop.
// Bridges the new definePage() query spec to the existing @manta/sdk hooks.
// Auto-injects route params (e.g., :id) as filters on detail pages.

import { useGraphQuery, useQuery } from '@manta/sdk'
import { useQuery as useRQ } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import type { BlockQueryDef, GraphQueryDef, HogQLQueryDef, NamedQueryDef } from '../primitives'
import { isGraphQuery, isHogQLQuery, isNamedQuery } from '../primitives'

export interface UseBlockQueryResult {
  data: Record<string, unknown> | unknown[]
  items: unknown[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

// ── HogQL fetcher (calls the admin relay endpoint, NOT PostHog directly) ──

async function fetchHogQLViaRelay(query: string): Promise<{
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
}> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('manta-auth-token') : null
  const res = await fetch('/api/admin/posthog/hogql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HogQL relay ${res.status}: ${text}`)
  }
  const json = (await res.json()) as { data: { columns: string[]; rows: Record<string, unknown>[]; rowCount: number } }
  return json.data
}

/**
 * Fetch data for a block based on its query prop.
 * Handles graph queries, named queries, and raw HogQL queries.
 * Auto-injects route :id param as filter on detail pages.
 */
export function useBlockQuery(query?: BlockQueryDef): UseBlockQueryResult {
  const params = useParams()
  const isGraph = isGraphQuery(query)
  const isNamed = isNamedQuery(query)
  const isHogQL = isHogQLQuery(query)

  // ── Graph query path ───────────────────────────────
  // Auto-inject route :id param as filter for detail pages
  const graphConfig = isGraph
    ? {
        ...(query as GraphQueryDef).graph,
        filters: (query as GraphQueryDef).graph.filters ?? (params.id ? { id: params.id } : undefined),
      }
    : { entity: '__disabled__' }
  const graphResult = useGraphQuery(graphConfig, { enabled: isGraph })

  // ── Named query path ───────────────────────────────
  // Resolve :param placeholders in input from route params
  const resolvedInput =
    isNamed && (query as NamedQueryDef).input
      ? Object.fromEntries(
          Object.entries((query as NamedQueryDef).input as Record<string, unknown>).map(([k, v]) => {
            if (typeof v === 'string' && v.startsWith(':') && params[v.slice(1)]) {
              return [k, params[v.slice(1)]]
            }
            return [k, v]
          }),
        )
      : isNamed
        ? (query as NamedQueryDef).input
        : undefined
  // Don't fire named queries if any :param placeholder is still unresolved
  const hasUnresolvedParams =
    resolvedInput && Object.values(resolvedInput).some((v) => typeof v === 'string' && v.startsWith(':'))
  if (isNamed && hasUnresolvedParams) {
    console.warn('[useBlockQuery] Blocked named query — unresolved params:', resolvedInput, 'route params:', params)
  }
  const namedResult = useQuery(isNamed ? (query as NamedQueryDef).name : '__disabled__', resolvedInput, {
    enabled: isNamed && !hasUnresolvedParams,
  })

  // ── HogQL query path ───────────────────────────────
  // Replaces :param placeholders in the raw HogQL string from route params.
  // This is a light templating — the user is expected to write safe HogQL.
  const hogqlString = isHogQL
    ? Object.entries(params).reduce(
        (acc, [key, val]) => (val ? acc.replaceAll(`:${key}`, String(val)) : acc),
        (query as HogQLQueryDef).hogql.query,
      )
    : ''
  const hogqlResult = useRQ({
    queryKey: ['hogql-block', hogqlString],
    queryFn: () => fetchHogQLViaRelay(hogqlString),
    enabled: isHogQL && hogqlString.length > 0,
  })

  const refetch = () => {
    if (isGraph) graphResult.refetch()
    if (isNamed) namedResult.refetch()
    if (isHogQL) hogqlResult.refetch()
  }

  if (!query) {
    return { data: {}, items: [], isLoading: false, error: null, refetch: () => {} }
  }

  // ── HogQL normalization ────────────────────────────
  // The relay returns { columns, rows, rowCount }. Blocks expect items (array) for DataTable
  // or data (object) for StatsCard. Heuristic: if only one row returned, treat as data (stats).
  // Otherwise treat as items (table). Blocks can override via an explicit config later if needed.
  if (isHogQL) {
    const rows = hogqlResult.data?.rows ?? []
    if (rows.length === 1) {
      // Single row → stats card shape
      return {
        data: rows[0],
        items: rows,
        isLoading: hogqlResult.isLoading,
        error: (hogqlResult.error as Error | null) ?? null,
        refetch,
      }
    }
    return {
      data: {},
      items: rows,
      isLoading: hogqlResult.isLoading,
      error: (hogqlResult.error as Error | null) ?? null,
      refetch,
    }
  }

  const result = isGraph ? graphResult : namedResult
  let rawData = result.data as unknown

  // Named queries may return { data: [...], count: N } or { items: [...], count: N } — unwrap
  if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
    if (Array.isArray((rawData as any).data)) {
      rawData = (rawData as any).data
    } else if (Array.isArray((rawData as any).items)) {
      rawData = (rawData as any).items
    }
  }

  // Normalize: if array, treat as items (list). On detail pages, find the matching record by ID.
  if (Array.isArray(rawData)) {
    // Detail page: filter by ID from route params
    if (params.id) {
      const match = rawData.find((r: any) => r.id === params.id) as Record<string, unknown> | undefined
      if (match) {
        return {
          data: match,
          items: [match],
          isLoading: result.isLoading,
          error: result.error,
          refetch,
        }
      }
    }
    return {
      data: {},
      items: rawData,
      isLoading: result.isLoading,
      error: result.error,
      refetch,
    }
  }

  return {
    data: (rawData as Record<string, unknown>) ?? {},
    items: [],
    isLoading: result.isLoading,
    error: result.error,
    refetch,
  }
}
