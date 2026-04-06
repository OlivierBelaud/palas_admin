import type React from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/utils'

const TableRoot = forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  ),
)
TableRoot.displayName = 'Table'

const TableHeader = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn('bg-background [&_tr]:border-0', className)} {...props} />
  ),
)
TableHeader.displayName = 'TableHeader'

const TableBody = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn('bg-card [&_tr:last-child]:border-0', className)} {...props} />
  ),
)
TableBody.displayName = 'TableBody'

const TableFooter = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)} {...props} />
  ),
)
TableFooter.displayName = 'TableFooter'

const TableRow = forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b border-border/50 last:border-0 transition-colors data-[state=selected]:bg-accent',
        className,
      )}
      {...props}
    />
  ),
)
TableRow.displayName = 'TableRow'

const TableHead = forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'h-12 px-4 text-left align-middle text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground first:ps-6 last:pe-6 last:text-right [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  ),
)
TableHead.displayName = 'TableHead'

const TableCell = forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        'px-4 py-4 align-middle first:ps-6 last:pe-6 last:text-right [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  ),
)
TableCell.displayName = 'TableCell'

const TableCaption = forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
  ),
)
TableCaption.displayName = 'TableCaption'

// ── Pagination component (matches @medusajs/ui Table.Pagination) ──

interface TablePaginationProps {
  className?: string
  canNextPage: boolean
  canPreviousPage: boolean
  nextPage: () => void
  previousPage: () => void
  count: number
  pageIndex: number
  pageCount: number
  pageSize: number
  translations?: {
    of?: string
    results?: string
    pages?: string
    prev?: string
    next?: string
  }
}

const TablePagination = forwardRef<HTMLDivElement, TablePaginationProps>(
  (
    {
      className,
      canNextPage,
      canPreviousPage,
      nextPage,
      previousPage,
      count,
      pageIndex,
      pageCount,
      pageSize,
      translations,
    },
    ref,
  ) => {
    const t = translations ?? {}
    const from = pageIndex * pageSize + 1
    const to = Math.min((pageIndex + 1) * pageSize, count)

    return (
      <div
        ref={ref}
        className={cn(
          'flex items-center justify-between border-t border-border/50 px-5 py-4 text-sm text-muted-foreground',
          className,
        )}
      >
        <span>
          {from}-{to} {t.of ?? 'of'} {count} {t.results ?? 'results'}
        </span>
        <div className="flex items-center gap-x-2">
          <span>
            {pageIndex + 1} {t.of ?? 'of'} {pageCount} {t.pages ?? 'pages'}
          </span>
          <button
            type="button"
            disabled={!canPreviousPage}
            onClick={previousPage}
            className="cursor-pointer rounded-md bg-accent px-2.5 py-1 text-xs transition-colors hover:bg-[#e0e0e0] disabled:cursor-default disabled:opacity-50"
          >
            {t.prev ?? 'Prev'}
          </button>
          <button
            type="button"
            disabled={!canNextPage}
            onClick={nextPage}
            className="cursor-pointer rounded-md bg-accent px-2.5 py-1 text-xs transition-colors hover:bg-[#e0e0e0] disabled:cursor-default disabled:opacity-50"
          >
            {t.next ?? 'Next'}
          </button>
        </div>
      </div>
    )
  },
)
TablePagination.displayName = 'TablePagination'

// ── Compound component to match @medusajs/ui Table API ──

const Table = Object.assign(TableRoot, {
  Header: TableHeader,
  Body: TableBody,
  Footer: TableFooter,
  Row: TableRow,
  Head: TableHead,
  HeaderCell: TableHead,
  Cell: TableCell,
  Caption: TableCaption,
  Pagination: TablePagination,
})

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TablePagination, TableRow }
