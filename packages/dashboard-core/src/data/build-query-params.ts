import type { DataSource } from '../interfaces/data-source'
import type { QueryDef } from '../pages/types'
import { resolveStateRef } from './resolve-state-ref'

interface QueryResult {
  endpoint: string
  params: Record<string, unknown>
}

export function buildQueryParams(
  query: Omit<QueryDef, 'expand'> & {
    expand?: Record<string, { fields?: string[]; expand?: Record<string, unknown> }>
  },
  state: Record<string, unknown>,
  dataSource: DataSource,
): QueryResult {
  const baseEndpoint = dataSource.entityToEndpoint(query.entity)
  const params: Record<string, unknown> = {}

  let endpoint = baseEndpoint
  if (query.id) {
    const resolvedId = resolveStateRef(query.id, state)
    if (resolvedId) {
      endpoint = `${baseEndpoint}/${resolvedId}`
    }
  }

  if (query.fields && typeof query.fields === 'string') {
    params.fields = query.fields
  }

  if (query.expand) {
    const expandFields: string[] = []
    for (const [relation, config] of Object.entries(query.expand)) {
      if (config && typeof config === 'object' && 'fields' in config && Array.isArray(config.fields)) {
        for (const field of config.fields) {
          expandFields.push(`+${relation}.${field}`)
        }
      }
    }
    if (expandFields.length > 0) {
      const existing = params.fields ? `${params.fields},` : ''
      params.fields = `${existing}${expandFields.join(',')}`
    }
  }

  if (query.pageSize) {
    params.limit = query.pageSize
  }

  if (query.filters) {
    const resolvedFilters = resolveStateRef(query.filters, state)
    if (resolvedFilters && typeof resolvedFilters === 'object') {
      Object.assign(params, resolvedFilters)
    }
  }

  if (query.sort) {
    const resolvedSort = resolveStateRef(query.sort, state) as { field: string; direction: string } | undefined
    if (resolvedSort?.field) {
      params.order = `${resolvedSort.field}:${resolvedSort.direction}`
    }
  }

  if (query.search) {
    const resolvedSearch = resolveStateRef(query.search, state)
    if (resolvedSearch) {
      params.q = resolvedSearch
    }
  }

  if (query.limit) {
    const resolvedLimit = resolveStateRef(query.limit, state)
    if (resolvedLimit !== undefined) {
      params.limit = resolvedLimit
    }
  }

  if (query.offset) {
    const resolvedOffset = resolveStateRef(query.offset, state)
    if (resolvedOffset !== undefined) {
      params.offset = resolvedOffset
    }
  }

  return { endpoint, params }
}
