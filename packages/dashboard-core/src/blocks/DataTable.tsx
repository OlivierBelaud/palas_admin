// DataTable block — listing table for pages.
// Uses URL params for pagination/search (shared across the page).
// For relation tables in detail pages, use RelationTable instead.

import React, { useMemo, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Skeleton } from '../components/common/skeleton'
import type { GraphQueryDef, NamedQueryDef } from '../primitives'
import { isGraphQuery } from '../primitives'
import { EntityTableRenderer } from '../renderers/blocks/entity-table'
import { useBlockQuery } from './use-block-query'

export interface DataTableBlockProps {
  query?: GraphQueryDef | NamedQueryDef
  title?: string
  columns: Array<{
    key: string
    label: string
    type?: string
    format?: string | Record<string, unknown>
    sortable?: boolean
  }>
  searchable?: string[] | boolean
  filterable?: Record<string, string[]> | boolean
  navigateTo?: string
  actions?: Array<{
    label: string
    action?: string
    to?: string
    destructive?: boolean
    icon?: string
    entity?: string
  }>
  rowActions?: Array<{
    label: string
    action?: string
    to?: string
    destructive?: boolean
    icon?: string
    entity?: string
  }>
  pageSize?: number
  pagination?: boolean
}

export function DataTableBlock({ query, ...props }: DataTableBlockProps) {
  const [searchParams] = useSearchParams()
  const params = useParams()
  const hadDataRef = useRef(false)

  // Inject URL search params (q, offset, order) into the graph query
  const enrichedQuery = useMemo(() => {
    if (!query || !isGraphQuery(query)) return query

    const q = searchParams.get('q') || undefined
    const offset = searchParams.get('offset')
    const order = searchParams.get('order')

    const graph = { ...query.graph }

    if (q) {
      ;(graph as any).q = q
    }
    if (offset) {
      graph.pagination = { ...graph.pagination, offset: Number(offset) }
    }
    if (order) {
      const desc = order.startsWith('-')
      const field = desc ? order.slice(1) : order
      graph.sort = { field, order: desc ? 'desc' : 'asc' }
    }

    // Inject column filters from URL (filter_key=value1,value2)
    const urlFilters: Record<string, unknown> = { ...graph.filters }
    for (const [key, value] of searchParams.entries()) {
      if (key.startsWith('filter_')) {
        const colKey = key.slice(7)
        const values = value.split(',').filter(Boolean)
        if (values.length === 1) {
          urlFilters[colKey] = values[0]
        } else if (values.length > 1) {
          urlFilters[colKey] = values
        }
      }
    }
    if (Object.keys(urlFilters).length > 0) {
      graph.filters = urlFilters
    }

    return { graph } as GraphQueryDef
  }, [query, searchParams])

  const { items, count, isLoading } = useBlockQuery(enrichedQuery)

  if (items.length > 0 || !isLoading) hadDataRef.current = true

  if (isLoading && !hadDataRef.current) {
    return React.createElement(Skeleton, { className: 'h-96 w-full' })
  }

  const columns = props.columns.map((col) => ({
    ...col,
    format: col.format ?? undefined,
    type: typeof col.format === 'string' ? col.format : col.type,
  }))

  return React.createElement(EntityTableRenderer, {
    component: {
      id: '',
      type: 'EntityTable',
      props: {
        ...props,
        columns,
        searchable: Array.isArray(props.searchable) ? true : props.searchable,
        pagination: props.pagination !== false,
        pageSize: props.pageSize,
        count,
        localPagination: !!params.id,
      },
    },
    data: { items, count },
  })
}
