import { Button, cn, DropdownMenu, IconButton, Input, Table, toast } from '@manta/ui'
import { useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, PaginationState, Row, VisibilityState } from '@tanstack/react-table'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  Check,
  ChevronsUpDown,
  MoreHorizontal,
  PlusCircle,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { DashboardContext } from '../../context'
import { resolveDataPath } from '../../data/index'
import type { BlockRendererProps } from './shared'
import { getActionIcon, PlaceholderCell, renderCellByType, Text } from './shared'

// ──────────────────────────────────────────────
// useSelectedParams — URL param management for filters/search
// ──────────────────────────────────────────────

function useSelectedParams({
  param,
  prefix,
  multiple = false,
}: {
  param: string
  prefix?: string
  multiple?: boolean
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const identifier = prefix ? `${prefix}_${param}` : param
  const offsetKey = prefix ? `${prefix}_offset` : 'offset'

  const add = useCallback(
    (value: string) => {
      setSearchParams((prev) => {
        const newValue = new URLSearchParams(prev)
        if (multiple) {
          const existingValues = newValue.get(identifier)?.split(',') || []
          if (!existingValues.includes(value)) {
            existingValues.push(value)
            newValue.set(identifier, existingValues.join(','))
          }
        } else {
          newValue.set(identifier, value)
        }
        newValue.delete(offsetKey)
        return newValue
      })
    },
    [setSearchParams, identifier, offsetKey, multiple],
  )

  const deleteParam = useCallback(
    (value?: string) => {
      setSearchParams((prev) => {
        if (value && multiple) {
          const existingValues = prev.get(identifier)?.split(',') || []
          const index = existingValues.indexOf(value)
          if (index > -1) {
            existingValues.splice(index, 1)
            prev.set(identifier, existingValues.join(','))
          }
          if (!prev.get(identifier)) {
            prev.delete(identifier)
          }
        } else {
          prev.delete(identifier)
        }
        prev.delete(offsetKey)
        return prev
      })
    },
    [setSearchParams, identifier, offsetKey, multiple],
  )

  const get = useCallback(() => {
    return searchParams.get(identifier)?.split(',').filter(Boolean) || []
  }, [searchParams, identifier])

  return { add, delete: deleteParam, get }
}

// ──────────────────────────────────────────────
// DataTableSearch — debounced search input
// ──────────────────────────────────────────────

function DataTableSearch({ prefix }: { prefix?: string }) {
  const selectedParams = useSelectedParams({ param: 'q', prefix, multiple: false })
  const initialQuery = selectedParams.get()
  const [localValue, setLocalValue] = useState(initialQuery?.[0] || '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setLocalValue(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        if (!value) {
          selectedParams.delete()
        } else {
          selectedParams.add(value)
        }
      }, 300)
    },
    [selectedParams],
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return React.createElement(Input, {
    autoComplete: 'off',
    name: 'q',
    type: 'search',
    size: 'small',
    value: localValue,
    onChange: handleChange,
    placeholder: 'Search',
  })
}

// ──────────────────────────────────────────────
// DataTableOrderBy — sort dropdown
// ──────────────────────────────────────────────

type OrderByKey = { key: string; label: string }

function DataTableOrderBy({ keys, prefix }: { keys: OrderByKey[]; prefix?: string }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const param = prefix ? `${prefix}_order` : 'order'

  type SortState = { key?: string; dir: 'asc' | 'desc' }

  const initState = (): SortState => {
    const sortParam = searchParams.get(param)
    if (!sortParam) return { dir: 'asc', key: undefined }
    const dir: 'asc' | 'desc' = sortParam.startsWith('-') ? 'desc' : 'asc'
    const key = sortParam.replace('-', '')
    return { key, dir }
  }

  const [state, setState] = useState<SortState>(initState)

  const updateOrderParam = useCallback(
    (s: { key?: string; dir: string }) => {
      if (!s.key) {
        setSearchParams((prev) => {
          prev.delete(param)
          return prev
        })
        return
      }
      const orderParam = s.dir === 'asc' ? s.key : `-${s.key}`
      setSearchParams((prev) => {
        prev.set(param, orderParam)
        return prev
      })
    },
    [setSearchParams, param],
  )

  const handleKeyChange = useCallback(
    (value: string) => {
      setState((prev) => {
        const newState = { ...prev, key: value }
        updateOrderParam(newState)
        return newState
      })
    },
    [updateOrderParam],
  )

  const handleDirChange = useCallback(
    (dir: string) => {
      setState((prev) => {
        const newState: SortState = { ...prev, dir: dir as 'asc' | 'desc' }
        updateOrderParam(newState)
        return newState
      })
    },
    [updateOrderParam],
  )

  return React.createElement(
    DropdownMenu,
    null,
    React.createElement(
      DropdownMenu.Trigger,
      { asChild: true },
      React.createElement(
        IconButton,
        { size: 'small', variant: 'ghost' },
        React.createElement(ArrowDownAZ, { className: 'h-4 w-4' }),
      ),
    ),
    React.createElement(
      DropdownMenu.Content,
      { className: 'z-[1]', align: 'end' },
      React.createElement(
        DropdownMenu.RadioGroup,
        {
          value: state.key,
          onValueChange: handleKeyChange,
        },
        keys.map((k) =>
          React.createElement(
            DropdownMenu.RadioItem,
            {
              key: k.key,
              value: k.key,
              onSelect: (e: Event) => e.preventDefault(),
            },
            k.label,
          ),
        ),
      ),
      React.createElement(DropdownMenu.Separator, null),
      React.createElement(
        DropdownMenu.RadioGroup,
        {
          value: state.dir,
          onValueChange: handleDirChange,
        },
        React.createElement(
          DropdownMenu.RadioItem,
          {
            className: 'flex items-center justify-between',
            value: 'asc',
            onSelect: (e: Event) => e.preventDefault(),
          },
          'Ascending',
        ),
        React.createElement(
          DropdownMenu.RadioItem,
          {
            className: 'flex items-center justify-between',
            value: 'desc',
            onSelect: (e: Event) => e.preventDefault(),
          },
          'Descending',
        ),
      ),
    ),
  )
}

// ──────────────────────────────────────────────
// ColumnsToggle — show/hide columns dropdown
// ──────────────────────────────────────────────

function ColumnsToggle({
  columns,
  columnVisibility,
  onToggle,
}: {
  columns: Array<{ id: string; label: string }>
  columnVisibility: VisibilityState
  onToggle: (columnId: string) => void
}) {
  return React.createElement(
    DropdownMenu,
    null,
    React.createElement(
      DropdownMenu.Trigger,
      { asChild: true },
      React.createElement(
        IconButton,
        { size: 'small', variant: 'ghost' },
        React.createElement(SlidersHorizontal, { className: 'h-4 w-4' }),
      ),
    ),
    React.createElement(
      DropdownMenu.Content,
      { className: 'z-[1]', align: 'end' },
      React.createElement(DropdownMenu.Label, null, 'Columns'),
      React.createElement(DropdownMenu.Separator, null),
      ...columns.map((col) => {
        const isVisible = columnVisibility[col.id] !== false
        return React.createElement(
          DropdownMenu.Item,
          {
            key: col.id,
            className: 'flex items-center gap-x-2',
            onSelect: (e: Event) => {
              e.preventDefault()
              onToggle(col.id)
            },
          },
          React.createElement(
            'div',
            {
              className: cn(
                'flex h-5 w-5 items-center justify-center rounded border',
                isVisible ? 'border-foreground bg-foreground text-background' : 'border-border',
              ),
            },
            isVisible
              ? React.createElement(
                  'svg',
                  {
                    width: '10',
                    height: '8',
                    viewBox: '0 0 10 8',
                    fill: 'none',
                    xmlns: 'http://www.w3.org/2000/svg',
                  },
                  React.createElement('path', {
                    d: 'M1 4L3.5 6.5L9 1',
                    stroke: 'currentColor',
                    strokeWidth: '1.5',
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                  }),
                )
              : null,
          ),
          col.label,
        )
      }),
    ),
  )
}

// ──────────────────────────────────────────────
// DataTableFilter — "Add filter" + active filter chips
// ──────────────────────────────────────────────

type FilterDef = {
  key: string
  label: string
  type: 'select' | 'multiselect' | 'radio'
  options: Array<{ label: string; value: string }>
}

function DataTableFilterBar({ filters, prefix }: { filters: FilterDef[]; prefix?: string }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeFilters, setActiveFilters] = useState<FilterDef[]>(() => {
    // Initialize from URL params
    return filters.filter((f) => {
      const key = prefix ? `${prefix}_${f.key}` : f.key
      return !!searchParams.get(key)
    })
  })
  const [menuOpen, setMenuOpen] = useState(false)

  const availableFilters = filters.filter((f) => !activeFilters.find((af) => af.key === f.key))

  const addFilter = useCallback((filter: FilterDef) => {
    setMenuOpen(false)
    setActiveFilters((prev) => [...prev, filter])
  }, [])

  const removeFilter = useCallback(
    (key: string) => {
      setActiveFilters((prev) => prev.filter((f) => f.key !== key))
      setSearchParams((prev) => {
        prev.delete(prefix ? `${prefix}_${key}` : key)
        prev.delete(prefix ? `${prefix}_offset` : 'offset')
        return prev
      })
    },
    [setSearchParams, prefix],
  )

  const removeAllFilters = useCallback(() => {
    setActiveFilters([])
    setSearchParams((prev) => {
      for (const f of filters) {
        prev.delete(prefix ? `${prefix}_${f.key}` : f.key)
      }
      prev.delete(prefix ? `${prefix}_offset` : 'offset')
      return prev
    })
  }, [setSearchParams, filters, prefix])

  return React.createElement(
    'div',
    {
      className: 'max-w-2/3 flex flex-wrap items-center gap-2',
    },
    // Active filter chips
    ...activeFilters.map((filter) =>
      React.createElement(SelectFilterChip, {
        key: filter.key,
        filter,
        prefix,
        multiple: filter.type === 'multiselect',
        onRemove: () => removeFilter(filter.key),
      }),
    ),
    // "Add filter" button
    availableFilters.length > 0
      ? React.createElement(
          DropdownMenu,
          {
            open: menuOpen,
            onOpenChange: setMenuOpen,
          },
          React.createElement(
            DropdownMenu.Trigger,
            { asChild: true },
            React.createElement(
              Button,
              {
                size: 'small',
                variant: 'secondary',
              },
              'Add filter',
            ),
          ),
          React.createElement(
            DropdownMenu.Content,
            {
              className: 'z-[1]',
              align: 'start',
            },
            availableFilters.map((filter) =>
              React.createElement(
                DropdownMenu.Item,
                {
                  key: filter.key,
                  onClick: () => addFilter(filter),
                },
                filter.label,
              ),
            ),
          ),
        )
      : null,
    // "Clear all" button
    activeFilters.length > 0
      ? React.createElement(
          'button',
          {
            type: 'button',
            onClick: removeAllFilters,
            className:
              'text-muted-foreground transition-colors text-sm font-medium rounded-md px-2 py-1 hover:text-muted-foreground',
          },
          'Clear all',
        )
      : null,
  )
}

// ──────────────────────────────────────────────
// SelectFilterChip — individual filter chip with dropdown
// ──────────────────────────────────────────────

function SelectFilterChip({
  filter,
  prefix,
  multiple,
  onRemove,
}: {
  filter: FilterDef
  prefix?: string
  multiple?: boolean
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const selectedParams = useSelectedParams({
    param: filter.key,
    prefix,
    multiple,
  })
  const currentValue = selectedParams.get()

  const labelValues = currentValue
    .map((v) => filter.options.find((o) => o.value === v)?.label)
    .filter(Boolean) as string[]

  const handleSelect = useCallback(
    (value: string) => {
      const isSelected = selectedParams.get().includes(value)
      if (isSelected) {
        selectedParams.delete(value)
      } else {
        selectedParams.add(value)
      }
    },
    [selectedParams],
  )

  const handleOpenChange = useCallback(
    (o: boolean) => {
      setOpen(o)
      if (!o && currentValue.length === 0) {
        setTimeout(() => onRemove(), 200)
      }
    },
    [currentValue.length, onRemove],
  )

  const displayValue = labelValues.join(', ')

  return React.createElement(
    DropdownMenu,
    {
      open,
      onOpenChange: handleOpenChange,
    },
    // Chip
    React.createElement(
      'div',
      {
        className:
          'bg-background transition-colors border shadow-sm text-muted-foreground flex cursor-default select-none items-stretch overflow-hidden rounded-md',
      },
      React.createElement(
        'div',
        {
          className: cn('flex items-center justify-center whitespace-nowrap px-2 py-1', {
            'border-r': !!displayValue,
          }),
        },
        React.createElement(Text, { size: 'small', weight: 'plus', leading: 'compact' as any }, filter.label),
      ),
      displayValue
        ? React.createElement(
            'div',
            { className: 'flex w-full items-center overflow-hidden' },
            React.createElement(
              'div',
              {
                className: 'border-r p-1 px-2',
              },
              React.createElement(
                Text,
                {
                  size: 'small',
                  weight: 'plus',
                  leading: 'compact' as any,
                  className: 'text-muted-foreground',
                },
                'is',
              ),
            ),
            React.createElement(
              DropdownMenu.Trigger,
              {
                asChild: true,
                className: 'flex-1 cursor-pointer overflow-hidden border-r p-1 px-2 hover:bg-background-hover',
              },
              React.createElement(
                Text,
                {
                  size: 'small',
                  leading: 'compact' as any,
                  weight: 'plus',
                  className: 'truncate text-nowrap',
                },
                displayValue,
              ),
            ),
            React.createElement(
              'button',
              {
                onClick: (e: React.MouseEvent) => {
                  e.stopPropagation()
                  onRemove()
                },
                className:
                  'text-muted-foreground transition-colors flex items-center justify-center p-1 hover:bg-muted-hover',
              },
              React.createElement(X, null),
            ),
          )
        : React.createElement(
            DropdownMenu.Trigger,
            {
              asChild: true,
              className: 'flex-1 cursor-pointer overflow-hidden border-l p-1 px-2 hover:bg-background-hover',
            },
            React.createElement(
              Text,
              {
                size: 'small',
                leading: 'compact' as any,
                className: 'text-muted-foreground',
              },
              'Select...',
            ),
          ),
    ),
    // Dropdown content
    React.createElement(
      DropdownMenu.Content,
      {
        className: 'z-[1] max-h-[200px] w-[300px] overflow-auto',
        align: 'start',
      },
      filter.options.map((option) => {
        const isSelected = currentValue.includes(option.value)
        return React.createElement(
          DropdownMenu.Item,
          {
            key: option.value,
            className: cn('flex items-center gap-x-2', {
              'bg-background-pressed': isSelected,
            }),
            onSelect: (e: Event) => {
              e.preventDefault()
              handleSelect(option.value)
            },
          },
          React.createElement(
            'div',
            {
              className: cn('flex h-5 w-5 items-center justify-center', {
                '[&_svg]:invisible': !isSelected,
              }),
            },
            React.createElement('div', {
              className: cn('h-2 w-2 rounded-full', {
                'bg-foreground': isSelected,
              }),
            }),
          ),
          option.label,
        )
      }),
    ),
  )
}

// ──────────────────────────────────────────────
// EntityTable — Uses @tanstack/react-table directly
// ──────────────────────────────────────────────

// ── Faceted Filter — shadcn pattern ─────────────────

function FacetedFilter({
  title,
  options,
  selected,
  onSelect,
}: {
  title: string
  options: Array<{ label: string; value: string }>
  selected: Set<string>
  onSelect: (values: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggle = (value: string) => {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onSelect(next)
  }

  return React.createElement(
    'div',
    { ref, className: 'relative' },
    // Trigger button — dashed border
    React.createElement(
      'button',
      {
        className: cn(
          'flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent',
          selected.size > 0 && 'border-foreground/30',
        ),
        onClick: () => setOpen(!open),
      },
      React.createElement(PlusCircle, { className: 'h-3.5 w-3.5 text-muted-foreground' }),
      title,
      selected.size > 0
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement('div', { className: 'h-4 w-px bg-border mx-1' }),
            React.createElement(
              'span',
              { className: 'rounded bg-accent px-1.5 py-0.5 text-xs font-medium' },
              String(selected.size),
            ),
          )
        : null,
    ),
    // Popover
    open
      ? React.createElement(
          'div',
          { className: 'absolute left-0 top-full z-50 mt-1 w-56 rounded-md border bg-background shadow-lg' },
          // Options list
          React.createElement(
            'div',
            { className: 'max-h-60 overflow-y-auto p-1' },
            options.map((opt) => {
              const isSelected = selected.has(opt.value)
              return React.createElement(
                'button',
                {
                  key: opt.value,
                  className: 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent text-left',
                  onClick: () => toggle(opt.value),
                },
                React.createElement(
                  'div',
                  {
                    className: cn(
                      'flex h-4 w-4 items-center justify-center rounded-sm border',
                      isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/30',
                    ),
                  },
                  isSelected ? React.createElement(Check, { className: 'h-3 w-3' }) : null,
                ),
                opt.label,
              )
            }),
          ),
          // Clear button
          selected.size > 0
            ? React.createElement(
                React.Fragment,
                null,
                React.createElement('div', { className: 'border-t' }),
                React.createElement(
                  'button',
                  {
                    className:
                      'flex w-full items-center justify-center py-2 text-xs text-muted-foreground hover:text-foreground',
                    onClick: () => {
                      onSelect(new Set())
                      setOpen(false)
                    },
                  },
                  'Clear filters',
                ),
              )
            : null,
        )
      : null,
  )
}

export function EntityTableRenderer({ component, data }: BlockRendererProps) {
  const _navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const props = component.props as {
    heading?: string
    subHeading?: string
    pageActions?: Array<{ label: string; to?: string; variant?: string }>
    columns: Array<{
      key: string
      label: string
      type?: string
      format?: unknown
      thumbnailKey?: string
      sortable?: boolean
      filterable?: boolean | string[]
    }>
    searchable?: boolean
    filterable?: boolean
    pagination?: boolean
    navigateTo?: string
    rowActions?: Array<{
      label: string
      icon?: string
      to?: string
      action?: string
      destructive?: boolean
      entity?: string
    }>
    orderBy?: Array<{ key: string; label: string }>
    actions?: Array<{
      label: string
      icon?: string
      to?: string
      action?: string
      destructive?: boolean
      entity?: string
    }>
    filters?: Array<{
      key: string
      label: string
      type: 'select' | 'multiselect' | 'radio'
      options: Array<{ label: string; value: string }>
    }>
    /** When true, removes negative margins (for rendering inside a Card) */
    inCard?: boolean
    /** Override page size (default: 15) */
    pageSize?: number
  }

  const rowActions = props.rowActions || props.actions || []
  const dashCtx = React.useContext(DashboardContext)
  const queryClient = useQueryClient()

  const items: Record<string, unknown>[] = Array.isArray(data) ? data : (data as any)?.items || []
  const count = (data as any)?.count ?? items.length
  const _pageSize = props.pageSize ?? 15

  // Auto-generate filters from columns with filterable: true
  // Cache auto-generated filters — only compute once when items first load
  const autoFiltersRef = useRef<typeof props.filters | null>(null)
  const autoFilters = useMemo(() => {
    if (props.filters && props.filters.length > 0) return props.filters
    if (autoFiltersRef.current) return autoFiltersRef.current

    if (items.length === 0) return undefined

    const generated: Array<{
      key: string
      label: string
      type: 'select' | 'multiselect'
      options: Array<{ label: string; value: string }>
    }> = []
    for (const col of props.columns) {
      if (!col.filterable) continue
      if (Array.isArray(col.filterable)) {
        generated.push({
          key: col.key,
          label: col.label,
          type: 'select',
          options: col.filterable.map((v) => ({
            label: String(v).replace(/\b\w/g, (c) => c.toUpperCase()),
            value: String(v),
          })),
        })
        continue
      }
      const values = new Set<string>()
      for (const item of items) {
        const v = resolveDataPath(item, col.key)
        if (v != null) values.add(String(v))
      }
      if (values.size > 0 && values.size <= 10) {
        generated.push({
          key: col.key,
          label: col.label,
          type: 'select',
          options: [...values].sort().map((v) => ({ label: v.replace(/\b\w/g, (c) => c.toUpperCase()), value: v })),
        })
      }
    }
    const result = generated.length > 0 ? generated : props.filters
    if (result) autoFiltersRef.current = result
    return result
  }, [props.columns, props.filters, items])

  // Faceted column filters — read from URL params (filter_{key}=value1,value2)
  const columnFilters = useMemo(() => {
    const filters: Record<string, Set<string>> = {}
    for (const [key, value] of searchParams.entries()) {
      if (key.startsWith('filter_')) {
        const colKey = key.slice(7) // Remove 'filter_' prefix
        filters[colKey] = new Set(value.split(',').filter(Boolean))
      }
    }
    return filters
  }, [searchParams])

  const setColumnFilter = useCallback(
    (colKey: string, values: Set<string>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (values.size === 0) {
          next.delete(`filter_${colKey}`)
        } else {
          next.set(`filter_${colKey}`, [...values].join(','))
        }
        next.delete('offset') // Reset pagination on filter change
        return next
      })
    },
    [setSearchParams],
  )

  // Items are NOT filtered client-side — filters go through the URL → DataTableBlock → graph query
  // But until the backend supports these filters, we filter client-side as a fallback
  const filteredItems = useMemo(() => {
    const activeFilters = Object.entries(columnFilters).filter(([, values]) => values.size > 0)
    if (activeFilters.length === 0) return items
    return items.filter((item) =>
      activeFilters.every(([key, values]) => {
        const v = resolveDataPath(item, key)
        return v != null && values.has(String(v))
      }),
    )
  }, [items, columnFilters])

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<{ entity: string; item: Record<string, unknown> } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleRowDelete = useCallback((entity: string, item: Record<string, unknown>) => {
    setDeleteTarget({ entity, item })
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      const ds = dashCtx?.dataSource as { command?: (name: string, body: Record<string, unknown>) => Promise<unknown> }
      if (typeof ds?.command === 'function') {
        await ds.command(`delete-${deleteTarget.entity}`, { id: deleteTarget.item.id })
      }
      queryClient.invalidateQueries()
      toast.success('Deleted successfully')
    } catch (e) {
      toast.error('Failed to delete', { description: (e as Error).message })
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
    }
  }, [deleteTarget, dashCtx, queryClient])

  // ── URL-based pagination ──
  const offset = searchParams.get('offset')
  const [paginationState, setPaginationState] = useState<PaginationState>({
    pageIndex: offset ? Math.ceil(Number(offset) / _pageSize) : 0,
    pageSize: _pageSize,
  })

  useEffect(() => {
    const index = offset ? Math.ceil(Number(offset) / _pageSize) : 0
    if (index === paginationState.pageIndex) return
    setPaginationState((prev) => ({ ...prev, pageIndex: index }))
  }, [offset, _pageSize, paginationState.pageIndex])

  const onPaginationChange = useCallback(
    (updater: ((old: PaginationState) => PaginationState) | PaginationState) => {
      const state = typeof updater === 'function' ? updater(paginationState) : updater
      const { pageIndex, pageSize } = state
      setSearchParams((prev) => {
        if (!pageIndex) {
          prev.delete('offset')
        } else {
          prev.set('offset', String(pageIndex * pageSize))
        }
        return prev
      })
      setPaginationState(state)
    },
    [paginationState, setSearchParams],
  )

  // ── Column visibility state ──
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => {
    const initial: VisibilityState = {}
    if (props.orderBy) {
      const visibleKeys = new Set(props.columns.map((c) => c.key))
      for (const ob of props.orderBy) {
        if (!visibleKeys.has(ob.key)) {
          initial[ob.key] = false
        }
      }
    }
    return initial
  })

  const toggleableColumns = useMemo(() => {
    const allCols: Array<{ id: string; label: string }> = []
    for (const col of props.columns) {
      allCols.push({ id: col.key, label: col.label })
    }
    if (props.orderBy) {
      const visibleKeys = new Set(props.columns.map((c) => c.key))
      for (const ob of props.orderBy) {
        if (!visibleKeys.has(ob.key)) {
          allCols.push({ id: ob.key, label: ob.label })
        }
      }
    }
    return allCols
  }, [props.columns, props.orderBy])

  const handleColumnToggle = useCallback((columnId: string) => {
    setColumnVisibility((prev) => ({
      ...prev,
      [columnId]: prev[columnId] === false,
    }))
  }, [])

  // ── Build @tanstack/react-table columns ──

  const hasActions = rowActions.length > 0

  const columns: ColumnDef<Record<string, unknown>, any>[] = useMemo(() => {
    const cols: ColumnDef<Record<string, unknown>, any>[] = []

    for (let i = 0; i < props.columns.length; i++) {
      const col = props.columns[i]
      const isFirst = i === 0
      const isSortable = col.sortable === true
      // Read current sort from URL
      const currentOrder = searchParams.get('order')
      const isCurrentSortAsc = currentOrder === col.key
      const isCurrentSortDesc = currentOrder === `-${col.key}`
      cols.push({
        id: col.key,
        header: isSortable
          ? () => {
              return React.createElement(
                'button',
                {
                  className:
                    'group/sort flex items-center gap-1 uppercase text-xs font-medium tracking-wider text-muted-foreground hover:text-foreground transition-colors w-full',
                  onClick: () => {
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev)
                      if (isCurrentSortAsc) {
                        next.set('order', `-${col.key}`)
                      } else if (isCurrentSortDesc) {
                        next.delete('order')
                      } else {
                        next.set('order', col.key)
                      }
                      next.delete('offset')
                      return next
                    })
                  },
                },
                col.label,
                // Show arrow always when sorted, show chevrons only on hover when not sorted
                isCurrentSortAsc
                  ? React.createElement(ArrowUp, { className: 'h-3 w-3' })
                  : isCurrentSortDesc
                    ? React.createElement(ArrowDown, { className: 'h-3 w-3' })
                    : React.createElement(ChevronsUpDown, {
                        className: 'h-3 w-3 opacity-0 group-hover/sort:opacity-50 transition-opacity',
                      }),
              )
            }
          : col.label,
        accessorFn: (row) => resolveDataPath(row, col.key),
        enableSorting: isSortable,
        cell:
          isFirst && !col.format
            ? (info) => {
                const val = resolveDataPath(info.row.original, col.key)
                if (val == null) return React.createElement(PlaceholderCell, null)
                return React.createElement('span', { className: 'text-sm font-semibold text-foreground' }, String(val))
              }
            : (info) => renderCellByType(col as Parameters<typeof renderCellByType>[0], info.row.original),
      })
    }

    // Add extra columns from orderBy that aren't in the explicit columns list
    if (props.orderBy) {
      const visibleKeys = new Set(props.columns.map((c) => c.key))
      for (const ob of props.orderBy) {
        if (!visibleKeys.has(ob.key)) {
          cols.push({
            id: ob.key,
            header: ob.label,
            accessorFn: (row) => resolveDataPath(row, ob.key),
            cell: (info) => renderCellByType({ key: ob.key, label: ob.label, type: 'date' }, info.row.original),
          })
        }
      }
    }

    // Add actions column if needed
    if (hasActions) {
      cols.push({
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const item = row.original
          return React.createElement(
            'div',
            { className: 'flex justify-end' },
            React.createElement(
              DropdownMenu,
              null,
              React.createElement(
                DropdownMenu.Trigger,
                { asChild: true },
                React.createElement(
                  IconButton,
                  {
                    variant: 'ghost',
                    size: 'small',
                  },
                  React.createElement(MoreHorizontal, { className: 'h-4 w-4 text-muted-foreground' }),
                ),
              ),
              React.createElement(
                DropdownMenu.Content,
                { align: 'end' },
                ...rowActions.flatMap((action, j) => {
                  const isDestructive = action.destructive
                  const icon = getActionIcon(action.icon)
                  const elements: React.ReactNode[] = []
                  // Add separator before destructive items
                  if (isDestructive && j > 0) {
                    elements.push(React.createElement(DropdownMenu.Separator, { key: `sep-${j}` }))
                  }
                  if (action.to) {
                    const resolvedTo = action.to.replace(/:(\w+)/g, (_, key) => String(item[key] || item.id || ''))
                    elements.push(
                      React.createElement(
                        DropdownMenu.Item,
                        {
                          key: j,
                          asChild: true,
                          className: isDestructive ? 'text-destructive' : undefined,
                        },
                        React.createElement(
                          Link,
                          { to: resolvedTo },
                          icon,
                          React.createElement('span', { className: icon ? 'ml-2' : undefined }, action.label),
                        ),
                      ),
                    )
                  } else {
                    elements.push(
                      React.createElement(
                        DropdownMenu.Item,
                        {
                          key: j,
                          className: isDestructive ? 'text-destructive' : undefined,
                          onClick:
                            action.action === 'delete' && action.entity
                              ? () => handleRowDelete(action.entity!, item)
                              : undefined,
                        },
                        icon,
                        React.createElement('span', { className: icon ? 'ml-2' : undefined }, action.label),
                      ),
                    )
                  }
                  return elements
                }),
              ),
            ),
          )
        },
      })
    }

    return cols
  }, [props.columns, rowActions, hasActions, handleRowDelete, props.orderBy, searchParams.get, setSearchParams])

  // ── Create table instance ──

  const table = useReactTable({
    data: filteredItems,
    columns,
    state: {
      pagination: paginationState,
      columnVisibility,
    },
    onColumnVisibilityChange: setColumnVisibility,
    pageCount: Math.ceil((filteredItems.length || count || 0) / _pageSize),
    getRowId: (row) => (row.id as string) || String(items.indexOf(row)),
    onPaginationChange: onPaginationChange as any,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: true,
  })

  // ── Navigate to row on click ──

  const getNavigateTo = useCallback(
    (row: Row<Record<string, unknown>>): string | undefined => {
      if (!props.navigateTo) return undefined
      return props.navigateTo.replace(/:(\w+)/g, (_, key) => String(row.original[key] || row.original.id || ''))
    },
    [props.navigateTo],
  )

  // ── Scroll to top on page change ──
  const scrollableRef = useRef<HTMLDivElement>(null)
  const { pageIndex } = table.getState().pagination

  useEffect(() => {
    scrollableRef.current?.scroll({ top: 0, left: 0 })
  }, [])

  // Column widths
  const hasSelect = false // no row selection for now
  const colCount = columns.length - (hasSelect ? 1 : 0) - (hasActions ? 1 : 0)
  const colWidth = 100 / colCount

  // ── Render ──

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'div',
      { className: props.inCard ? 'flex flex-col gap-y-4' : 'flex flex-col gap-y-4 -mx-6' },

      // ── Row 1: DataTableQuery — filters left, search + orderBy right ──
      props.searchable !== false || props.orderBy || (autoFilters && autoFilters.length > 0)
        ? React.createElement(
            'div',
            {
              className: 'flex items-start justify-between gap-x-4 px-6 pb-2',
            },
            // Left side: faceted filters
            React.createElement(
              'div',
              { className: 'flex items-center gap-2 flex-wrap' },
              ...(autoFilters ?? []).map((filter) =>
                React.createElement(FacetedFilter, {
                  key: filter.key,
                  title: filter.label,
                  options: filter.options,
                  selected: columnFilters[filter.key] ?? new Set(),
                  onSelect: (values) => setColumnFilter(filter.key, values),
                }),
              ),
            ),
            // Right side: search + orderBy
            React.createElement(
              'div',
              {
                className: 'flex shrink-0 items-center gap-x-2',
              },
              props.searchable !== false ? React.createElement(DataTableSearch, null) : null,
              props.orderBy && props.orderBy.length > 0
                ? React.createElement(DataTableOrderBy, {
                    keys: props.orderBy,
                  })
                : null,
              toggleableColumns.length > 0
                ? React.createElement(ColumnsToggle, {
                    columns: toggleableColumns,
                    columnVisibility,
                    onToggle: handleColumnToggle,
                  })
                : null,
            ),
          )
        : null,

      // ── DataTableRoot: Table + Pagination ──
      React.createElement(
        'div',
        {
          className: 'flex w-full flex-col overflow-hidden bg-card',
        },
        React.createElement(
          'div',
          {
            ref: scrollableRef,
            className: 'w-full overflow-x-auto',
          },
          React.createElement(
            Table,
            { className: 'relative w-full' },
            React.createElement(
              Table.Header,
              { className: 'border-t-0' },
              table.getHeaderGroups().map((headerGroup) =>
                React.createElement(
                  Table.Row,
                  {
                    key: headerGroup.id,
                    className: cn({
                      'relative border-b-0 [&_th:last-of-type]:w-[1%] [&_th:last-of-type]:whitespace-nowrap':
                        hasActions,
                    }),
                  },
                  headerGroup.headers.map((header) => {
                    const isActionHeader = header.id === 'actions'
                    return React.createElement(
                      Table.HeaderCell,
                      {
                        key: header.id,
                        style: {
                          width: !isActionHeader ? `${colWidth}%` : undefined,
                        },
                      },
                      flexRender(header.column.columnDef.header, header.getContext()),
                    )
                  }),
                ),
              ),
            ),
            items.length > 0
              ? React.createElement(
                  Table.Body,
                  { className: 'border-b-0' },
                  table.getRowModel().rows.map((row) => {
                    const to = getNavigateTo(row)
                    return React.createElement(
                      Table.Row,
                      {
                        key: row.id,
                        className: cn(
                          'transition-colors group/row',
                          '[&_td:last-of-type]:w-[1%] [&_td:last-of-type]:whitespace-nowrap',
                          { 'cursor-pointer': !!to },
                        ),
                      },
                      row.getVisibleCells().map((cell, index, arr) => {
                        const isFirstCell = index === 0
                        const isLastCell = index === arr.length - 1
                        const _isSelectCell = false
                        const shouldRenderAsLink = !!to && cell.column.id !== 'actions'

                        const Inner = flexRender(cell.column.columnDef.cell, cell.getContext())

                        if (shouldRenderAsLink) {
                          return React.createElement(
                            Table.Cell,
                            {
                              key: cell.id,
                              className: '!ps-0 !pe-0',
                            },
                            React.createElement(
                              Link,
                              {
                                to: to!,
                                className: 'size-full outline-none',
                                tabIndex: isFirstCell ? 0 : -1,
                              },
                              React.createElement(
                                'div',
                                {
                                  className: cn('flex size-full items-center px-4', {
                                    'ps-6': isFirstCell,
                                    'justify-end': isLastCell,
                                  }),
                                },
                                Inner,
                              ),
                            ),
                          )
                        }

                        return React.createElement(
                          Table.Cell,
                          {
                            key: cell.id,
                          },
                          Inner,
                        )
                      }),
                    )
                  }),
                )
              : null,
          ),
          // "No results" message — outside the Table, centered
          filteredItems.length === 0
            ? React.createElement(
                'div',
                { className: 'flex items-center justify-center py-16 text-muted-foreground text-sm' },
                'No results found',
              )
            : null,
        ),
        // Pagination
        props.pagination !== false
          ? React.createElement(Table.Pagination, {
              className: 'flex-shrink-0',
              canNextPage: table.getCanNextPage(),
              canPreviousPage: table.getCanPreviousPage(),
              nextPage: table.nextPage,
              previousPage: table.previousPage,
              count,
              pageIndex: table.getState().pagination.pageIndex,
              pageCount: table.getPageCount(),
              pageSize: table.getState().pagination.pageSize,
              translations: {
                of: 'of',
                results: 'results',
                pages: 'pages',
                prev: 'Prev',
                next: 'Next',
              },
            })
          : null,
      ),
    ), // close the div
    // Delete confirmation dialog — inline to avoid Radix/React version issues
    deleteTarget
      ? ReactDOM.createPortal(
          React.createElement(
            'div',
            { className: 'fixed inset-0 z-50 flex items-center justify-center' },
            // Overlay
            React.createElement('div', {
              className: 'fixed inset-0 bg-black/80 animate-in fade-in-0',
              onClick: () => setDeleteTarget(null),
            }),
            // Dialog
            React.createElement(
              'div',
              {
                className: 'relative z-50 grid w-full max-w-lg gap-4 border bg-background p-6 shadow-lg sm:rounded-lg',
              },
              // Header
              React.createElement(
                'div',
                { className: 'flex flex-col space-y-2 text-center sm:text-left' },
                React.createElement('h2', { className: 'text-lg font-semibold' }, 'Are you sure?'),
                React.createElement(
                  'p',
                  { className: 'text-sm text-muted-foreground' },
                  `You are about to delete${(deleteTarget.item.title ?? deleteTarget.item.name ?? deleteTarget.item.email ?? deleteTarget.item.first_name) ? ` "${deleteTarget.item.title ?? deleteTarget.item.name ?? deleteTarget.item.email ?? deleteTarget.item.first_name}"` : ' this record'}. This action cannot be undone.`,
                ),
              ),
              // Footer
              React.createElement(
                'div',
                { className: 'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2' },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    disabled: isDeleting,
                    onClick: () => setDeleteTarget(null),
                    className:
                      'inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-semibold hover:bg-accent hover:text-accent-foreground',
                  },
                  'Cancel',
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    disabled: isDeleting,
                    onClick: confirmDelete,
                    className:
                      'inline-flex h-10 items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90',
                  },
                  isDeleting ? 'Deleting...' : 'Delete',
                ),
              ),
            ),
          ),
          document.body,
        )
      : null,
  )
}
