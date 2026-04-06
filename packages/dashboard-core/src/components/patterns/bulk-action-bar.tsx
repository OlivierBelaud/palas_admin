// BulkActionBar — Floating action bar shown when rows are selected in a table.
// Appears at the bottom of the screen with selected count + action buttons.
//
// Usage:
//   {selectedIds.length > 0 && (
//     <BulkActionBar
//       count={selectedIds.length}
//       onClear={() => setSelectedIds([])}
//       actions={[
//         { label: 'Delete', onClick: handleDelete, destructive: true },
//         { label: 'Export', onClick: handleExport },
//       ]}
//     />
//   )}

import { cn } from '@manta/ui'
import { X } from 'lucide-react'
import type React from 'react'

export interface BulkAction {
  label: string
  onClick: () => void
  /** Red destructive styling. */
  destructive?: boolean
  /** Disabled state. */
  disabled?: boolean
  /** Icon component. */
  icon?: React.ReactNode
}

export interface BulkActionBarProps {
  count: number
  onClear: () => void
  actions: BulkAction[]
}

export function BulkActionBar({ count, onClear, actions }: BulkActionBarProps) {
  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg">
      {/* Count + clear */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{count} selected</span>
        <button type="button" onClick={onClear} className="rounded-sm p-0.5 hover:bg-muted">
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      <div className="h-5 w-px bg-border" />

      {/* Actions */}
      <div className="flex items-center gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              action.destructive ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-muted',
              action.disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}
