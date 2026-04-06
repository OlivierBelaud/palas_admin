// AIDataTable — Lightweight table for AI chat responses.
// 100% in-memory: search, filters, pagination — no URL params.
// Shares cell rendering with the main EntityTable but has its own layout.

import { Input, Table } from '@manta/ui'
import type React from 'react'
import { useMemo, useState } from 'react'
import { resolveDataPath } from '../data/index'
import { renderCellByType } from '../renderers/blocks/shared'

interface Column {
  key: string
  label: string
  type?: string
  format?: unknown
  filterable?: boolean | string[]
}

interface AIDataTableProps {
  items: Record<string, unknown>[]
  columns: Column[]
  title?: string
  searchable?: boolean
  pageSize?: number
}

export function AIDataTable({ items, columns, title, searchable = true, pageSize = 5 }: AIDataTableProps) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState<Record<string, string>>({})

  // Search across all visible columns
  const searched = useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter((item) =>
      columns.some((col) => {
        const v = resolveDataPath(item, col.key)
        return v != null && String(v).toLowerCase().includes(q)
      }),
    )
  }, [items, search, columns])

  // Apply column filters
  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v !== '')
    if (active.length === 0) return searched
    return searched.filter((item) =>
      active.every(([key, value]) => {
        const v = resolveDataPath(item, key)
        return v != null && String(v) === value
      }),
    )
  }, [searched, filters])

  // Pagination
  const totalPages = Math.ceil(filtered.length / pageSize)
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize)

  // Auto-detect filterable columns (enums with <= 10 unique values)
  const filterableColumns = useMemo(() => {
    const result: Array<{ key: string; label: string; options: string[] }> = []
    for (const col of columns) {
      if (!col.filterable) continue
      if (Array.isArray(col.filterable)) {
        result.push({ key: col.key, label: col.label, options: col.filterable })
        continue
      }
      const values = new Set<string>()
      for (const item of items) {
        const v = resolveDataPath(item, col.key)
        if (v != null) values.add(String(v))
      }
      if (values.size > 0 && values.size <= 10) {
        result.push({ key: col.key, label: col.label, options: [...values].sort() })
      }
    }
    return result
  }, [columns, items])

  return (
    <div className="flex flex-col gap-y-2 pt-3">
      {/* Header: title + count */}
      {title && (
        <div className="flex items-center justify-between px-3">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">{filtered.length} results</span>
        </div>
      )}

      {/* Search + Filters */}
      {(searchable || filterableColumns.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 px-3">
          {searchable && (
            <Input
              size="small"
              placeholder="Search..."
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setSearch(e.target.value)
                setPage(0)
              }}
              className="h-8 w-44 text-xs"
            />
          )}
          {filterableColumns.map((f) => (
            <select
              key={f.key}
              value={filters[f.key] ?? ''}
              onChange={(e) => {
                setFilters((prev) => ({ ...prev, [f.key]: e.target.value }))
                setPage(0)
              }}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            >
              <option value="">{f.label}</option>
              {f.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ))}
        </div>
      )}

      {/* Table */}
      <Table>
        <Table.Header>
          <Table.Row>
            {columns
              .filter((col) => col?.key)
              .map((col) => (
                <Table.HeaderCell key={col.key}>{col.label ?? col.key}</Table.HeaderCell>
              ))}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {paged.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={columns.length} className="py-6 text-center text-sm text-muted-foreground">
                No results
              </Table.Cell>
            </Table.Row>
          ) : (
            paged.map((item, i) => (
              <Table.Row key={(item.id as string) ?? i}>
                {columns
                  .filter((col) => col?.key)
                  .map((col) => {
                    let value: unknown
                    try {
                      value = resolveDataPath(item, col.key)
                    } catch {
                      value = item[col.key]
                    }
                    if (Array.isArray(value)) {
                      return <Table.Cell key={col.key}>{value.length}</Table.Cell>
                    }
                    if (value != null && typeof value === 'object') {
                      return <Table.Cell key={col.key}>{JSON.stringify(value).slice(0, 50)}</Table.Cell>
                    }
                    if (value == null) {
                      return <Table.Cell key={col.key}>—</Table.Cell>
                    }
                    try {
                      return <Table.Cell key={col.key}>{renderCellByType(value, col, item)}</Table.Cell>
                    } catch {
                      return <Table.Cell key={col.key}>{String(value)}</Table.Cell>
                    }
                  })}
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 pb-2">
          <span className="text-xs text-muted-foreground">
            {page * pageSize + 1}-{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-2 text-xs text-muted-foreground">
              {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
