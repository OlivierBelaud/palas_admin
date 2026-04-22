// DataTable block — listing table for pages.
// Uses URL params for pagination/search (shared across the page).
// For relation tables in detail pages, use RelationTable instead.

import { Button, Card } from '@manta/ui'
import React, { useMemo, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Skeleton } from '../components/common/skeleton'
import type { GraphQueryDef, NamedQueryDef } from '../primitives'
import { isGraphQuery } from '../primitives'
import { EntityTableRenderer } from '../renderers/blocks/entity-table'
import { Heading, Text } from '../renderers/blocks/shared'
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
    filterable?: boolean | string[]
  }>
  searchable?: string[] | boolean
  filterable?: Record<string, string[]> | boolean
  /**
   * Block-level filter chips rendered above the table. Each option's `value`
   * is written to the URL (`filter_<key>=<value>`) and injected into
   * `graph.filters`. Magic tokens `__null` / `__notnull` translate to IS NULL
   * / IS NOT NULL predicates server-side.
   */
  filters?: Array<{
    key: string
    label: string
    type: 'select' | 'multiselect' | 'radio'
    options: Array<{ label: string; value: string }>
  }>
  navigateTo?: string
  actions?: Array<{
    label: string
    /**
     * Visual style:
     * - 'button' (default) — filled Button
     * - 'link' — inline styled anchor (discreet, opens in new tab by default)
     */
    kind?: 'button' | 'link'
    action?: string
    /** Static destination URL. Takes precedence over `source` when both present. */
    to?: string
    /**
     * Derive the destination URL from a named query's response field.
     * The query's `:param` placeholders resolve from the page route (e.g. `:id`).
     * If the query errors or the field is missing, the action hides itself.
     */
    source?: { name: string; input?: Record<string, unknown>; field: string }
    destructive?: boolean
    icon?: string
    entity?: string
    /** Override target when kind='link'. Defaults to '_blank' for external URLs. */
    target?: '_blank' | '_self'
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
  /**
   * Wrap the table in a Card. Accepts `true` for a minimal card using `title`
   * and `actions`, or an object to add `description`.
   */
  card?: boolean | { description?: string }
  /**
   * Highlight rows whose `field` is truthy. Useful for flagging a subset of
   * rows (VIP customer, already-purchased, out-of-sync…). Page definitions
   * are JSON-serializable, so we take a field name + a class name rather
   * than a predicate function.
   */
  rowHighlight?: {
    field: string
    /** Tailwind class applied to the `<tr>` when `row[field]` is truthy. Defaults to `bg-muted/40`. */
    className?: string
  }
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
    // Magic tokens: `__null` → IS NULL, `__notnull` → IS NOT NULL. Let UI options
    // express presence filters without having to encode operator objects in URLs.
    const translateValue = (v: string): unknown => {
      if (v === '__null') return { $null: true }
      if (v === '__notnull') return { $notnull: true }
      return v
    }
    const urlFilters: Record<string, unknown> = { ...graph.filters }
    for (const [key, value] of searchParams.entries()) {
      if (key.startsWith('filter_')) {
        const colKey = key.slice(7)
        const values = value.split(',').filter(Boolean)
        if (values.length === 1) {
          urlFilters[colKey] = translateValue(values[0])
        } else if (values.length > 1) {
          const translated = values.map(translateValue)
          // If any magic token is in the set, split into multiple conditions via $in/$null.
          // For a simple multi-select on scalar values, keep the legacy array form.
          const hasMagic = translated.some((v) => typeof v === 'object' && v !== null)
          urlFilters[colKey] = hasMagic ? translated : values
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

  const tableEl = React.createElement(EntityTableRenderer, {
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
        inCard: !!props.card,
        rowHighlight: props.rowHighlight,
        // Title rendered by the Card header instead — avoid duplicate heading.
        title: props.card ? undefined : props.title,
      },
    },
    data: { items, count },
  })

  if (!props.card) return tableEl

  const cardCfg = typeof props.card === 'object' ? props.card : {}
  const headerActions = (props.actions ?? []).map((a, i) =>
    React.createElement(CardHeaderAction, { key: i, action: a }),
  )

  // Match StatsCard structure: `divide-y p-0` on Card creates the horizontal
  // rule between header and body without requiring a manual border.
  return React.createElement(
    Card,
    { className: 'divide-y p-0 overflow-hidden' },
    React.createElement(
      'div',
      { className: 'flex items-center justify-between gap-x-4 px-6 py-4' },
      React.createElement(
        'div',
        { className: 'flex flex-col gap-y-1 min-w-0' },
        props.title ? React.createElement(Heading, { level: 'h2' }, props.title) : null,
        cardCfg.description
          ? React.createElement(Text, { size: 'small', className: 'text-muted-foreground' }, cardCfg.description)
          : null,
      ),
      headerActions.length > 0
        ? React.createElement('div', { className: 'flex items-center gap-x-3 shrink-0' }, ...headerActions)
        : null,
    ),
    tableEl,
  )
}

type CardHeaderActionProps = {
  action: NonNullable<DataTableBlockProps['actions']>[number]
}

function CardHeaderAction({ action }: CardHeaderActionProps) {
  // Resolve dynamic `to` from a named query source (if provided).
  const sourceQuery = action.source
    ? ({ name: action.source.name, input: action.source.input } as NamedQueryDef)
    : undefined
  const { data: sourceData, isLoading } = useBlockQuery(sourceQuery)

  let resolvedTo = action.to
  if (!resolvedTo && action.source) {
    const val = (sourceData as Record<string, unknown>)?.[action.source.field]
    if (typeof val === 'string' && val.length > 0) resolvedTo = val
  }

  // Hide the action until the source URL is known — avoids dead links.
  if (action.source && !resolvedTo) {
    if (isLoading) return null
    return null
  }
  if (!resolvedTo && !action.action) return null

  const isExternal = typeof resolvedTo === 'string' && /^https?:\/\//.test(resolvedTo)
  const target = action.target ?? (isExternal ? '_blank' : undefined)

  if (action.kind === 'link') {
    return React.createElement(
      'a',
      {
        href: resolvedTo,
        target,
        rel: target === '_blank' ? 'noopener noreferrer' : undefined,
        className:
          'text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground transition-colors',
      },
      action.label,
    )
  }

  // Default: Button style
  if (resolvedTo) {
    if (isExternal) {
      return React.createElement(
        Button,
        { size: 'small', variant: action.destructive ? ('destructive' as const) : ('default' as const), asChild: true },
        React.createElement(
          'a',
          { href: resolvedTo, target, rel: target === '_blank' ? 'noopener noreferrer' : undefined },
          action.label,
        ),
      )
    }
    return React.createElement(
      Button,
      { size: 'small', variant: action.destructive ? ('destructive' as const) : ('default' as const), asChild: true },
      React.createElement(Link, { to: resolvedTo }, action.label),
    )
  }
  return React.createElement(
    Button,
    { size: 'small', variant: action.destructive ? ('destructive' as const) : ('default' as const) },
    action.label,
  )
}
