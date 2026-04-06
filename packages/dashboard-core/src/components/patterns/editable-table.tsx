// EditableTable — Inline editable data table (Excel-like).
// Used in FocusModal for batch editing (prices, stock, variants, etc.)
//
// Usage:
//   <EditableTable
//     columns={[
//       { key: 'sku', label: 'SKU', editable: false },
//       { key: 'price', label: 'Price', type: 'number' },
//       { key: 'quantity', label: 'Stock', type: 'number' },
//     ]}
//     rows={variants}
//     onChange={(rows) => setVariants(rows)}
//   />

import { cn } from '@manta/ui'
import type React from 'react'
import { useCallback, useState } from 'react'

export interface EditableColumn {
  key: string
  label: string
  /** Column type. Default: 'text' */
  type?: 'text' | 'number' | 'select'
  /** Options for select type. */
  options?: string[]
  /** Whether the column is editable. Default: true */
  editable?: boolean
  /** Column width class. */
  width?: string
}

export interface EditableTableProps<T extends Record<string, unknown>> {
  columns: EditableColumn[]
  rows: T[]
  /** Called when any cell changes. Receives the full updated rows array. */
  onChange: (rows: T[]) => void
  /** Row key field. Default: 'id' */
  rowKey?: string
}

export function EditableTable<T extends Record<string, unknown>>({
  columns,
  rows,
  onChange,
  rowKey = 'id',
}: EditableTableProps<T>) {
  const [focusedCell, setFocusedCell] = useState<{ row: number; col: number } | null>(null)

  const updateCell = useCallback(
    (rowIndex: number, key: string, value: unknown) => {
      const updated = rows.map((row, i) => (i === rowIndex ? { ...row, [key]: value } : row))
      onChange(updated)
    },
    [rows, onChange],
  )

  const handleKeyDown = (e: React.KeyboardEvent, rowIndex: number, colIndex: number) => {
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault()
      const editableCols = columns.filter((c) => c.editable !== false)
      const nextCol = colIndex + 1
      if (nextCol < editableCols.length) {
        setFocusedCell({ row: rowIndex, col: nextCol })
      } else if (rowIndex + 1 < rows.length) {
        setFocusedCell({ row: rowIndex + 1, col: 0 })
      }
    }
    if (e.key === 'Escape') {
      setFocusedCell(null)
      ;(e.target as HTMLElement).blur()
    }
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn('px-3 py-2 text-left text-xs font-medium text-muted-foreground', col.width)}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={String(row[rowKey] ?? rowIndex)} className="border-b last:border-0">
              {columns.map((col, colIndex) => {
                const isEditable = col.editable !== false
                const isFocused = focusedCell?.row === rowIndex && focusedCell?.col === colIndex
                const value = row[col.key]

                return (
                  <td
                    key={col.key}
                    className={cn(
                      'px-3 py-1.5',
                      isEditable && 'cursor-text',
                      isFocused && 'ring-2 ring-inset ring-primary',
                    )}
                    onClick={() => isEditable && setFocusedCell({ row: rowIndex, col: colIndex })}
                  >
                    {!isEditable ? (
                      <span className="text-muted-foreground">{String(value ?? '')}</span>
                    ) : col.type === 'select' ? (
                      <select
                        value={String(value ?? '')}
                        onChange={(e) => updateCell(rowIndex, col.key, e.target.value)}
                        className="w-full bg-transparent text-sm outline-none"
                      >
                        {col.options?.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={col.type === 'number' ? 'number' : 'text'}
                        value={value == null ? '' : String(value)}
                        onChange={(e) =>
                          updateCell(rowIndex, col.key, col.type === 'number' ? Number(e.target.value) : e.target.value)
                        }
                        onKeyDown={(e) => handleKeyDown(e, rowIndex, colIndex)}
                        onFocus={() => setFocusedCell({ row: rowIndex, col: colIndex })}
                        onBlur={() => setFocusedCell(null)}
                        className="w-full bg-transparent text-sm outline-none"
                      />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
