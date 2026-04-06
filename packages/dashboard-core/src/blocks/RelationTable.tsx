// RelationTable block — table of related entities inside a detail page.
// Wrapped in a Card. Pagination and search are local state (not URL).
// Default page size: 5.

import { Button, Card, DropdownMenu, Table, toast } from '@manta/ui'
import { MoreHorizontal } from 'lucide-react'
import React, { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Skeleton } from '../components/common/skeleton'
import { DashboardContext } from '../context'
import type { GraphQueryDef, NamedQueryDef } from '../primitives'
import { type ColumnFormat, getActionIcon, Heading, renderCellByType } from '../renderers/blocks/shared'
import { useBlockQuery } from './use-block-query'

export interface RowAction {
  label: string
  icon?: string
  to?: string
  action?: string
  entity?: string
  destructive?: boolean
}

export interface HeaderAction {
  label: string
  to?: string
  icon?: string
}

export interface RelationTableBlockProps {
  query?: GraphQueryDef | NamedQueryDef
  title: string
  columns: Array<{ key: string; label: string; type?: string; format?: string | ColumnFormat; sortable?: boolean }>
  searchable?: boolean
  navigateTo?: string
  pageSize?: number
  actions?: HeaderAction[]
  rowActions?: RowAction[]
}

export function RelationTableBlock({ query, ...props }: RelationTableBlockProps) {
  const navigate = useNavigate()
  const params = useParams()
  const dashCtx = React.useContext(DashboardContext)
  const pageSize = props.pageSize ?? 5
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const rowActions = props.rowActions ?? []
  const headerActions = props.actions ?? []

  const { items, isLoading, refetch } = useBlockQuery(query)

  const columns = props.columns.map((col) => ({
    ...col,
    format: col.format ?? undefined,
    type: typeof col.format === 'string' ? col.format : col.type,
  }))

  // Filter by search (local, in-memory)
  const filtered = useMemo(() => {
    if (!search.trim()) return items as Record<string, unknown>[]
    const needle = search.toLowerCase()
    return (items as Record<string, unknown>[]).filter((row) =>
      columns.some((col) => {
        const v = row[col.key]
        return v != null && String(v).toLowerCase().includes(needle)
      }),
    )
  }, [items, search, columns])

  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize)
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))

  const handleSearch = (value: string) => {
    clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      setSearch(value)
      setPage(0)
    }, 300)
  }

  if (isLoading && items.length === 0) {
    return React.createElement(Skeleton, { className: 'h-64 w-full' })
  }

  return React.createElement(
    Card,
    { className: 'p-0 overflow-hidden' },

    // Header
    React.createElement(
      'div',
      { className: 'border-b px-6 py-4 flex items-center justify-between' },
      React.createElement(Heading, { level: 'h2' }, props.title),
      headerActions.length > 0
        ? React.createElement(
            'div',
            { className: 'flex items-center gap-2' },
            ...headerActions.map((ha, i) =>
              ha.to
                ? React.createElement(
                    Link,
                    { key: i, to: ha.to },
                    React.createElement(Button, { variant: 'secondary', size: 'small' }, ha.label),
                  )
                : React.createElement(Button, { key: i, variant: 'secondary', size: 'small' }, ha.label),
            ),
          )
        : null,
    ),

    // Filter bar (same background as table header — transparent/white)
    props.searchable !== false
      ? React.createElement(
          'div',
          { className: 'bg-background px-6 py-3 flex items-center justify-end' },
          React.createElement('input', {
            type: 'search',
            placeholder: 'Search',
            defaultValue: search,
            className:
              'h-8 w-[200px] rounded-md bg-white px-3 text-sm placeholder:text-muted-foreground focus:outline-none',
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleSearch(e.target.value),
          }),
        )
      : null,

    // Table
    React.createElement(
      'div',
      { className: 'w-full overflow-x-auto' },
      React.createElement(
        Table,
        { className: 'relative w-full' },
        React.createElement(
          Table.Header,
          null,
          React.createElement(
            Table.Row,
            null,
            ...columns.map((col) => React.createElement(Table.HeaderCell, { key: col.key }, col.label)),
            rowActions.length > 0
              ? React.createElement(Table.HeaderCell, { key: '__actions', className: 'w-[60px]' })
              : null,
          ),
        ),
        React.createElement(
          Table.Body,
          null,
          paged.length > 0
            ? paged.map((row, i) => {
                const to = props.navigateTo
                  ? props.navigateTo.replace(/:(\w+)/g, (_, key) => String((row as any)[key] || (row as any).id || ''))
                  : undefined
                return React.createElement(
                  Table.Row,
                  {
                    key: (row as any).id || i,
                    className: to ? 'cursor-pointer hover:bg-accent/50' : undefined,
                    onClick: to ? () => navigate(to) : undefined,
                  },
                  ...columns.map((col) =>
                    React.createElement(
                      Table.Cell,
                      { key: col.key },
                      renderCellByType(col as any, row as Record<string, unknown>),
                    ),
                  ),
                  rowActions.length > 0
                    ? React.createElement(
                        Table.Cell,
                        {
                          key: '__actions',
                          className: 'w-[60px]',
                          onClick: (e: React.MouseEvent) => e.stopPropagation(),
                        },
                        React.createElement(
                          DropdownMenu,
                          null,
                          React.createElement(
                            DropdownMenu.Trigger,
                            { asChild: true },
                            React.createElement(
                              Button,
                              { variant: 'ghost', size: 'small' },
                              React.createElement(MoreHorizontal, { className: 'h-4 w-4 text-muted-foreground' }),
                            ),
                          ),
                          React.createElement(
                            DropdownMenu.Content,
                            { align: 'end' },
                            ...rowActions.flatMap((action, j) => {
                              const elements: React.ReactNode[] = []
                              if (action.destructive && j > 0) {
                                elements.push(React.createElement(DropdownMenu.Separator, { key: `sep-${j}` }))
                              }
                              const resolvedTo = action.to
                                ? action.to
                                    .replace(/:row\.(\w+)/g, (_, key) => String((row as any)[key] ?? ''))
                                    .replace(/:(\w+)/g, (_, key) => String(params[key] ?? (row as any)[key] ?? ''))
                                : undefined
                              if (resolvedTo) {
                                elements.push(
                                  React.createElement(
                                    DropdownMenu.Item,
                                    {
                                      key: j,
                                      asChild: true,
                                      className: action.destructive ? 'text-destructive' : undefined,
                                    },
                                    React.createElement(
                                      Link,
                                      { to: resolvedTo },
                                      getActionIcon(action.icon),
                                      action.label,
                                    ),
                                  ),
                                )
                              } else if (action.action === 'delete' && action.entity) {
                                elements.push(
                                  React.createElement(
                                    DropdownMenu.Item,
                                    {
                                      key: j,
                                      className: action.destructive ? 'text-destructive' : undefined,
                                      onClick: async () => {
                                        const ds = dashCtx?.dataSource as {
                                          command?: (name: string, body: Record<string, unknown>) => Promise<unknown>
                                        }
                                        try {
                                          if (typeof ds?.command === 'function') {
                                            await ds.command(`delete-${action.entity}`, { id: (row as any).id })
                                          }
                                          toast.success('Deleted')
                                          refetch()
                                        } catch (e) {
                                          toast.error('Failed', { description: (e as Error).message })
                                        }
                                      },
                                    },
                                    getActionIcon(action.icon),
                                    action.label,
                                  ),
                                )
                              }
                              return elements
                            }),
                          ),
                        ),
                      )
                    : null,
                )
              })
            : React.createElement(
                Table.Row,
                null,
                React.createElement(
                  Table.Cell,
                  {
                    colSpan: columns.length + (rowActions.length > 0 ? 1 : 0),
                    className: 'text-center py-10 text-muted-foreground text-sm',
                  } as any,
                  'No records',
                ),
              ),
        ),
      ),
    ),

    // Pagination
    React.createElement(
      'div',
      { className: 'flex items-center justify-between px-6 py-3 text-sm text-muted-foreground' },
      React.createElement(
        'span',
        null,
        filtered.length > 0
          ? `${page * pageSize + 1}-${Math.min((page + 1) * pageSize, filtered.length)} of ${filtered.length} results`
          : '0 results',
      ),
      React.createElement(
        'div',
        { className: 'flex items-center gap-2' },
        React.createElement('span', null, `${page + 1} of ${totalPages} pages`),
        React.createElement(
          'button',
          {
            className: 'rounded border px-3 py-1 text-xs disabled:opacity-50',
            disabled: page === 0,
            onClick: () => setPage((p) => p - 1),
          },
          'Prev',
        ),
        React.createElement(
          'button',
          {
            className: 'rounded border px-3 py-1 text-xs disabled:opacity-50',
            disabled: page >= totalPages - 1,
            onClick: () => setPage((p) => p + 1),
          },
          'Next',
        ),
      ),
    ),
  )
}
