/**
 * useSpecQuery — custom hook that encapsulates all data-fetching logic
 * previously inlined in SpecRenderer.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { buildQueryParams } from '../../data/build-query-params'
import type { DataSource } from '../../interfaces/data-source'
import type { PageSpec } from '../../pages/types'
import { extractFiltersFromSearchParams, parseSpecResponse } from '../lib/spec-query-builder'

// ──────────────────────────────────────────────
// URL builder
// ──────────────────────────────────────────────

const SYSTEM_PARAMS = new Set(['fields', 'limit', 'offset', 'q', 'order'])
const RESERVED_KEYS = new Set(['q', 'offset', 'order', 'limit'])

function buildFetchUrl(
  spec: PageSpec,
  state: Record<string, unknown>,
  searchParams: URLSearchParams,
  dataSource: DataSource,
): string {
  const { endpoint, params: queryParams } = buildQueryParams(
    spec.query as Parameters<typeof buildQueryParams>[0],
    state,
    dataSource,
  )

  const url = new URL(endpoint, window.location.origin)
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null) {
      if (SYSTEM_PARAMS.has(key)) {
        url.searchParams.set(key, String(value))
      } else {
        url.searchParams.append(`${key}[]`, String(value))
      }
    }
  }

  if (spec.type === 'list') {
    const urlLimit = searchParams.get('limit')
    url.searchParams.set('limit', urlLimit || '15')
    const urlQ = searchParams.get('q') || ''
    const urlOffset = searchParams.get('offset') || ''
    const urlOrder = searchParams.get('order') || ''
    if (urlQ) url.searchParams.set('q', urlQ)
    if (urlOffset) url.searchParams.set('offset', urlOffset)
    if (urlOrder) url.searchParams.set('order', urlOrder)

    const filters = extractFiltersFromSearchParams(searchParams, RESERVED_KEYS)
    for (const [key, value] of Object.entries(filters)) {
      const values = Array.isArray(value) ? value : [value]
      for (const v of values) {
        url.searchParams.append(`${key}[]`, v)
      }
    }
  }

  return url.toString()
}

// ──────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────

interface UseSpecQueryOptions {
  resolvedSpec: PageSpec
  params?: Record<string, string>
  dataSource: DataSource
}

interface UseSpecQueryResult {
  data: Record<string, unknown>
  items: unknown[]
  rawData: unknown
  isLoading: boolean
  error: Error | null
}

export function useSpecQuery({ resolvedSpec, params, dataSource }: UseSpecQueryOptions): UseSpecQueryResult {
  const [searchParams] = useSearchParams()

  const state: Record<string, unknown> = {
    route: { params: params || {} },
  }

  // Stable search params key for dependency arrays
  const searchParamsKey = useMemo(() => {
    const entries: Record<string, string> = {}
    searchParams.forEach((v, k) => {
      entries[k] = v
    })
    return JSON.stringify(entries)
  }, [searchParams])

  // Resolve entity ID from spec
  const resolvedId = resolvedSpec.query.id
    ? typeof resolvedSpec.query.id === 'object' && '$state' in resolvedSpec.query.id
      ? params?.[resolvedSpec.query.id.$state.split('/').pop() || 'id']
      : String(resolvedSpec.query.id)
    : undefined

  // Stable filter key
  const specFiltersKey = useMemo(
    () => (resolvedSpec.query.filters ? JSON.stringify(resolvedSpec.query.filters) : ''),
    [resolvedSpec.query.filters],
  )

  // Query key
  const entityKey = dataSource.getQueryKey(resolvedSpec.query.entity)
  const queryKey = useMemo(() => {
    if (resolvedSpec.type === 'detail' && resolvedId) {
      return [entityKey, 'detail', resolvedId]
    }
    return [entityKey, 'list', { search: searchParamsKey, pageId: resolvedSpec.id, filters: specFiltersKey }]
  }, [entityKey, resolvedSpec.type, resolvedSpec.id, resolvedId, searchParamsKey, specFiltersKey])

  // Stable params key for URL building
  const _paramsKey = useMemo(() => JSON.stringify(params || {}), [params])

  // Fetch URL (GET fallback)
  const fetchUrl = useMemo(
    () => buildFetchUrl(resolvedSpec, state, searchParams, dataSource),
    [resolvedSpec, dataSource, searchParams, state],
  )

  // CQRS query body (POST /api/admin/query)
  const queryBody = useMemo(() => {
    const body: Record<string, unknown> = { entity: resolvedSpec.query.entity }

    // Include fields if specified (comma-separated string → array)
    if (resolvedSpec.query.fields) {
      body.fields =
        typeof resolvedSpec.query.fields === 'string'
          ? resolvedSpec.query.fields.split(',').map((f: string) => f.trim())
          : resolvedSpec.query.fields
    }

    if (resolvedId) body.id = resolvedId

    if (resolvedSpec.type === 'list') {
      body.limit = Number.parseInt(searchParams.get('limit') || String(resolvedSpec.query.pageSize || 15), 10)
      const urlOffset = searchParams.get('offset')
      if (urlOffset) body.offset = Number.parseInt(urlOffset, 10)
      const urlQ = searchParams.get('q')
      if (urlQ) body.q = urlQ
      const urlOrder = searchParams.get('order')
      if (urlOrder) body.order = urlOrder

      // Collect filters from URL — shared utility
      const filters: Record<string, unknown> = extractFiltersFromSearchParams(searchParams)

      // Merge spec-level filters
      if (resolvedSpec.query.filters) {
        const resolved =
          typeof resolvedSpec.query.filters === 'object' && '$state' in resolvedSpec.query.filters
            ? undefined
            : resolvedSpec.query.filters
        if (resolved) Object.assign(filters, resolved)
      }
      if (Object.keys(filters).length > 0) body.filters = filters
    }

    return body
  }, [resolvedSpec, resolvedId, searchParams])

  // Data fetching
  const {
    data: rawData,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      // CQRS: POST /api/admin/query with body
      // biome-ignore lint/suspicious/noExplicitAny: data source may have query()
      const ds = dataSource as any
      if (typeof ds.query === 'function') {
        return ds.query(queryBody)
      }
      // Fallback: GET with query string (Medusa compat)
      const res = await fetch(fetchUrl, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return res.json()
    },
    placeholderData: keepPreviousData,
  })

  // Parse response — deterministic key selection
  const { data, items } = useMemo(() => parseSpecResponse(rawData, resolvedSpec.type), [rawData, resolvedSpec.type])

  return { data, items, rawData, isLoading, error: error as Error | null }
}
