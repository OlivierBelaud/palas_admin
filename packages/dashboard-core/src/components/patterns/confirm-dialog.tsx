// ConfirmDialog — Confirmation dialog for destructive actions.
//
// Usage:
//   <ConfirmDialog
//     open={open}
//     onClose={() => setOpen(false)}
//     title="Delete Product"
//     description="This action cannot be undone. This will permanently delete the product."
//     onConfirm={() => deleteProduct.mutate(productId)}
//     confirmLabel="Delete"
//     destructive
//   />

import { cn } from '@manta/ui'
import { AlertTriangle } from 'lucide-react'
import React from 'react'

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  onConfirm: () => void
  /** Text for confirm button. Default: 'Confirm' */
  confirmLabel?: string
  /** Text for cancel button. Default: 'Cancel' */
  cancelLabel?: string
  /** Red destructive styling for confirm button. Default: false */
  destructive?: boolean
  /** Show loading state on confirm button. */
  loading?: boolean
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  onConfirm,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
}: ConfirmDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <div className="flex items-start gap-4">
          {destructive && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-lg font-semibold">{title}</h3>
            {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-md px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm()
              onClose()
            }}
            disabled={loading}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium text-white',
              destructive ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90',
              loading && 'opacity-50 cursor-not-allowed',
            )}
          >
            {loading ? 'Loading...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
