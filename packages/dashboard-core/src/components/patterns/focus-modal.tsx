// FocusModal — Medusa-style full-width modal with overlay backdrop.
// The page underneath is visible through the semi-transparent overlay.
// The modal has rounded corners and an inset border — like a floating card.
//
// Usage:
//   <FocusModal open={open} onClose={close} title="Create Product">
//     <form>...</form>
//     <FocusModal.Footer>
//       <Button variant="ghost" onClick={close}>Cancel</Button>
//       <Button type="submit">Save</Button>
//     </FocusModal.Footer>
//   </FocusModal>

import { cn } from '@manta/ui'
import { X } from 'lucide-react'
import type React from 'react'
import { createContext, useContext } from 'react'

interface FocusModalContextValue {
  onClose: () => void
}

const FocusModalContext = createContext<FocusModalContextValue>({ onClose: () => {} })

export interface FocusModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  /** Footer content — rendered fixed at the bottom, outside the scrollable area */
  footer?: React.ReactNode
  /** Max width of the content area. Default: 'max-w-[720px]' */
  maxWidth?: string
}

export function FocusModal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 'max-w-[720px]',
}: FocusModalProps) {
  if (!open) return null

  return (
    <FocusModalContext.Provider value={{ onClose }}>
      {/* Overlay backdrop — page visible behind */}
      <div className="fixed inset-0 z-50 bg-black/40 animate-in fade-in-0" onClick={onClose} />

      {/* Modal card — inset from edges, rounded, with shadow */}
      <div className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-xl bg-background shadow-2xl animate-in fade-in-0 zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        {/* Body — scrollable, centered content */}
        <div className="flex-1 overflow-y-auto">
          <div className={cn('mx-auto flex w-full flex-col gap-y-8 px-2 py-16', maxWidth)}>{children}</div>
        </div>
        {/* Footer — fixed at bottom, outside scrollable area */}
        {footer && <div className="flex items-center justify-end gap-2 border-t bg-background px-6 py-4">{footer}</div>}
      </div>
    </FocusModalContext.Provider>
  )
}

/** Sticky footer — renders at the bottom of the FocusModal */
FocusModal.Footer = function FocusModalFooter({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background px-6 py-4', className)}
    >
      {children}
    </div>
  )
}

/** Hook to access the modal's onClose from child components */
export function useFocusModal() {
  return useContext(FocusModalContext)
}
