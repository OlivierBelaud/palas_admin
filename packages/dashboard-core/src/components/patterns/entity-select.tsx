// EntitySelect — Modal with a searchable table for selecting entities.
// Supports single-select and multi-select modes.
//
// Usage:
//   <EntitySelect
//     open={open}
//     onClose={close}
//     title="Select Products"
//     items={products}
//     columns={[
//       { key: 'title', label: 'Title' },
//       { key: 'sku', label: 'SKU' },
//     ]}
//     onSelect={(selected) => handleSelect(selected)}
//     multiple
//   />

import { cn } from '@manta/ui'
import { Check, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

export interface EntitySelectColumn {
  key: string
  label: string
}

export interface EntitySelectProps<T extends { id: string }> {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  items: T[]
  columns: EntitySelectColumn[]
  /** Callback when selection is confirmed. */
  onSelect: (selected: T[]) => void
  /** Allow multiple selection. Default: false */
  multiple?: boolean
  /** Already selected IDs. */
  selected?: string[]
  /** Searchable fields. Default: all column keys. */
  searchFields?: string[]
  /** Max width of the modal. Default: 'max-w-3xl' */
  maxWidth?: string
}

export function EntitySelect<T extends { id: string }>({
  open,
  onClose,
  title,
  description,
  items,
  columns,
  onSelect,
  multiple = false,
  selected: initialSelected = [],
  searchFields,
  maxWidth = 'max-w-3xl',
}: EntitySelectProps<T>) {
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelected))

  const fields = searchFields ?? columns.map((c) => c.key)

  const filtered = useMemo(() => {
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter((item) =>
      fields.some((field) => {
        const val = (item as Record<string, unknown>)[field]
        return typeof val === 'string' && val.toLowerCase().includes(q)
      }),
    )
  }, [items, search, fields])

  const toggle = (id: string) => {
    const next = new Set(selectedIds)
    if (multiple) {
      if (next.has(id)) next.delete(id)
      else next.add(id)
    } else {
      next.clear()
      next.add(id)
    }
    setSelectedIds(next)
  }

  const confirm = () => {
    const result = items.filter((item) => selectedIds.has(item.id))
    onSelect(result)
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className={cn('flex max-h-[80vh] w-full flex-col rounded-lg border bg-background shadow-lg', maxWidth)}>
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-sm opacity-70 hover:opacity-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search */}
        <div className="flex items-center border-b px-6 py-3">
          <Search className="mr-2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {selectedIds.size > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">{selectedIds.size} selected</span>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-muted/50">
              <tr>
                <th className="w-10 px-3 py-2" />
                {columns.map((col) => (
                  <th key={col.key} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const isSelected = selectedIds.has(item.id)
                return (
                  <tr
                    key={item.id}
                    onClick={() => toggle(item.id)}
                    className={cn(
                      'cursor-pointer border-b transition-colors hover:bg-muted/50',
                      isSelected && 'bg-primary/5',
                    )}
                  >
                    <td className="px-3 py-2">
                      <div
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded-sm border',
                          isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>
                    </td>
                    {columns.map((col) => (
                      <td key={col.key} className="px-3 py-2 text-sm">
                        {String((item as Record<string, unknown>)[col.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No results found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={selectedIds.size === 0}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {multiple ? `Select (${selectedIds.size})` : 'Select'}
          </button>
        </div>
      </div>
    </div>
  )
}
