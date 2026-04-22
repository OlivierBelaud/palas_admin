// DataList block — display-only list rendered as a CSS-grid. No pagination, sort,
// URL state, or totals. Structure mirrors DataTable's Card wrapping (Heading +
// actions) but the body is a <ul> with per-row grid tracks. Column widths are
// derived from a per-column `width` config, matching the Medusa order-summary
// pattern. Cell rendering is delegated to shared renderers (`renderCellByType`,
// `renderCellByFormat`) so formatting behavior is identical to DataTable.

import { Button, Card, cn } from '@manta/ui'
import React, { useRef } from 'react'
import { Link } from 'react-router-dom'
import { Skeleton } from '../components/common/skeleton'
import { resolveDataPath } from '../data/index'
import type { GraphQueryDef, NamedQueryDef } from '../primitives'
import type { ColumnFormat } from '../renderers/blocks/shared'
import { Heading, renderCellByType, Text } from '../renderers/blocks/shared'
import type { DataTableBlockProps } from './DataTable'
import { useBlockQuery } from './use-block-query'

// ── Types ─────────────────────────────────────────────

export interface DataListColumn {
  /** Dotted path into the row (e.g. `title`, `customer.email`). */
  key: string
  /** Header label — rendered only when `showHeaders` is true. */
  label?: string
  /** Cell type — matches `renderCellByType` in shared.ts. */
  type?: 'thumbnail' | 'badge' | 'count' | 'list-count' | 'text'
  /** Rich format passed straight to `renderCellByFormat`. */
  format?: string | Record<string, unknown>
  /** Dotted path to the thumbnail source (for `type: 'thumbnail'`). */
  thumbnailKey?: string
  /**
   * Secondary fields rendered stacked under the primary value (for `type: 'thumbnail'`).
   * Mirrors Medusa's product-line cell: title on top, SKU + variant_title below.
   */
  subKeys?: string[]
  /** CSS grid track value (e.g. `'1fr'`, `'auto'`, `'120px'`, `'minmax(0,1fr)'`). */
  width?: string
  /** Horizontal alignment. Defaults to `'start'`. */
  align?: 'start' | 'center' | 'end'
  /** Extra classes applied on the cell wrapper. */
  className?: string
  /** Static text appended right after the cell value (e.g. `'x'` for quantity → `'3x'`). */
  suffix?: string
}

export interface DataListBlockProps {
  query?: GraphQueryDef | NamedQueryDef
  title?: string
  /** Wrap in a Card. `true` for a minimal card, object to add `description`. Defaults to `true`. */
  card?: boolean | { description?: string }
  /** Hide the Card header (title + actions) while keeping the wrapper. */
  hideHeader?: boolean
  /** Render a header row above the list. Defaults to `false` (Medusa Summary style). */
  showHeaders?: boolean
  actions?: DataTableBlockProps['actions']
  /** Dotted path to the items array on the query response. Falls back to `items`. */
  itemsKey?: string
  columns: DataListColumn[]
  /** Text shown when the list is empty. Defaults to `'Aucun élément'`. */
  emptyLabel?: string
  /** Dotted path to the row's unique key. Defaults to `row.id` then index. */
  rowKey?: string
  /** Vertical row density. `'compact'` uses `py-1.5` instead of `py-4`. Defaults to `'normal'`. */
  density?: 'normal' | 'compact'
  /** Render thin dividers between rows. Defaults to `true`. Set false for tight grouped lists (totals, summary). */
  dividers?: boolean
}

// ── Helpers ───────────────────────────────────────────

function alignClass(align?: 'start' | 'center' | 'end'): string {
  if (align === 'center') return 'justify-center text-center'
  if (align === 'end') return 'justify-end text-right'
  return 'justify-start text-left'
}

function buildGridTemplate(columns: DataListColumn[]): string {
  return columns.map((c) => c.width ?? '1fr').join(' ')
}

/**
 * Resolve the effective items array for the block.
 * Priority: `itemsKey` dotted path on `data` → `items` from the hook → empty array.
 * Exported for unit tests.
 */
export function resolveDataListItems(
  data: Record<string, unknown> | unknown[],
  items: unknown[],
  itemsKey?: string,
): unknown[] {
  if (itemsKey) {
    const resolved = resolveDataPath(data, itemsKey)
    if (Array.isArray(resolved)) return resolved
    return []
  }
  if (Array.isArray(items) && items.length > 0) return items
  if (Array.isArray(data)) return data
  return items ?? []
}

/** Normalize `format` — accepts a string shortcut or an object description. */
function toColumnFormat(format: DataListColumn['format']): ColumnFormat | undefined {
  if (format == null) return undefined
  if (typeof format === 'string') return format
  return format as ColumnFormat
}

/**
 * Square 40px thumbnail with light border + muted background — mirrors Medusa's
 * order-summary product cell. We render this locally instead of calling
 * shared.ts's `Thumbnail` because the listing variant requires a larger square.
 */
function ProductThumbnail({ src }: { src?: string | null }) {
  return React.createElement(
    'div',
    {
      className:
        'bg-muted flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-border',
    },
    src
      ? React.createElement('img', {
          src,
          alt: '',
          className: 'h-full w-full object-cover object-center',
          loading: 'lazy',
        })
      : null,
  )
}

/**
 * Medusa-style product line cell: thumbnail on the left + stacked title with
 * optional secondary fields (SKU, variant_title, …) underneath.
 */
function renderProductLine(col: DataListColumn, record: Record<string, unknown>): React.ReactElement {
  const thumbSrc = col.thumbnailKey ? (resolveDataPath(record, col.thumbnailKey) as string | null) : null
  const titleValue = resolveDataPath(record, col.key)
  const subValues = (col.subKeys ?? []).map((k) => resolveDataPath(record, k)).filter((v) => v != null && v !== '')

  return React.createElement(
    'div',
    { className: 'flex items-start gap-x-3 min-w-0 w-full' },
    React.createElement(ProductThumbnail, { src: thumbSrc }),
    React.createElement(
      'div',
      { className: 'flex flex-col min-w-0 gap-y-0.5' },
      React.createElement('span', { className: 'text-sm text-foreground truncate' }, String(titleValue ?? '—')),
      ...subValues.map((v, i) =>
        React.createElement('span', { key: i, className: 'text-xs text-muted-foreground truncate' }, String(v)),
      ),
    ),
  )
}

/**
 * Cell dispatcher: rich product-line layout when `type='thumbnail'` + `subKeys`
 * (Medusa pattern), otherwise delegates to the shared `renderCellByType`
 * (consistent formatting with DataTable).
 */
function renderCell(col: DataListColumn, record: Record<string, unknown>): React.ReactNode {
  if (col.type === 'thumbnail' && col.subKeys && col.subKeys.length > 0) {
    return renderProductLine(col, record)
  }
  return renderCellByType(
    {
      key: col.key,
      label: col.label ?? '',
      type: col.type,
      format: toColumnFormat(col.format),
      thumbnailKey: col.thumbnailKey,
    },
    record,
  )
}

/**
 * Build the pure body tree (empty state OR <ul> of rows) for a DataList.
 * Exported so tests can inspect the returned React element tree without
 * mounting or running hooks.
 */
export function buildDataListBody(
  items: unknown[],
  columns: DataListColumn[],
  opts: {
    showHeaders?: boolean
    emptyLabel?: string
    rowKey?: string
    density?: 'normal' | 'compact'
    dividers?: boolean
  } = {},
): React.ReactElement {
  const { showHeaders = false, emptyLabel = 'Aucun élément', rowKey, density = 'normal', dividers = true } = opts
  const gridTemplateColumns = buildGridTemplate(columns)
  const rowPaddingClass = density === 'compact' ? 'py-1.5' : 'py-4'

  if (!items || items.length === 0) {
    return React.createElement('div', { className: 'px-6 py-10 text-center text-sm text-muted-foreground' }, emptyLabel)
  }

  const headerRow = showHeaders
    ? React.createElement(
        'div',
        {
          role: 'row',
          className:
            'grid items-center gap-x-4 px-6 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground',
          style: { gridTemplateColumns },
        },
        ...columns.map((col, i) =>
          React.createElement(
            'div',
            { key: i, className: cn('min-w-0', alignClass(col.align), col.className) },
            col.label ?? '',
          ),
        ),
      )
    : null

  const listEl = React.createElement(
    'ul',
    { className: cn('py-2', dividers && 'divide-y divide-border/50') },
    items.map((row, rowIndex) => {
      const record = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>
      const key = rowKey ? (resolveDataPath(record, rowKey) as string | number | undefined) : undefined
      const resolvedKey = key != null ? String(key) : ((record.id as string | number | undefined) ?? rowIndex)
      // Convention: items with `_emphasis: true` render with stronger weight
      // and full-opacity foreground (used for totals, key summary lines, …).
      const isEmphasis = record._emphasis === true
      return React.createElement(
        'li',
        {
          key: String(resolvedKey),
          role: 'row',
          className: cn(
            'grid items-center gap-x-4 px-6 text-ui-fg-subtle',
            rowPaddingClass,
            isEmphasis && 'font-semibold text-foreground [&_span]:text-foreground! [&_span]:font-semibold!',
          ),
          style: { gridTemplateColumns },
        },
        ...columns.map((col, colIndex) =>
          React.createElement(
            'div',
            {
              key: colIndex,
              className: cn('min-w-0 flex items-center', alignClass(col.align), col.className),
            },
            renderCell(col, record),
            col.suffix
              ? React.createElement('span', { className: 'text-sm tabular-nums text-muted-foreground' }, col.suffix)
              : null,
          ),
        ),
      )
    }),
  )

  if (!headerRow) return listEl
  return React.createElement('div', { className: 'flex flex-col' }, headerRow, listEl)
}

// ── Component ─────────────────────────────────────────

export function DataListBlock({ query, ...props }: DataListBlockProps) {
  const { data, items, isLoading } = useBlockQuery(query)
  const hadDataRef = useRef(false)

  const resolvedItems = resolveDataListItems(data, items, props.itemsKey)
  if (resolvedItems.length > 0 || !isLoading) hadDataRef.current = true

  if (isLoading && !hadDataRef.current) {
    return React.createElement(Skeleton, { className: 'h-32 w-full' })
  }

  const body = buildDataListBody(resolvedItems, props.columns, {
    showHeaders: props.showHeaders,
    emptyLabel: props.emptyLabel,
    rowKey: props.rowKey,
    density: props.density,
    dividers: props.dividers,
  })

  const useCard = props.card !== false
  if (!useCard) return body

  const cardCfg = typeof props.card === 'object' ? props.card : {}
  const headerActions = (props.actions ?? []).map((a, i) =>
    React.createElement(DataListHeaderAction, { key: i, action: a }),
  )

  const header = props.hideHeader
    ? null
    : React.createElement(
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
      )

  return React.createElement(Card, { className: 'divide-y p-0 overflow-hidden' }, header, body)
}

// ── Header action ─────────────────────────────────────
// Copy of DataTable's CardHeaderAction (simplified). Duplicated intentionally —
// tracked in BACKLOG.md as a dedupe follow-up.

type DataListHeaderActionProps = {
  action: NonNullable<DataListBlockProps['actions']>[number]
}

function DataListHeaderAction({ action }: DataListHeaderActionProps) {
  const sourceQuery = action.source
    ? ({ name: action.source.name, input: action.source.input } as NamedQueryDef)
    : undefined
  const { data: sourceData, isLoading } = useBlockQuery(sourceQuery)

  let resolvedTo = action.to
  if (!resolvedTo && action.source) {
    const val = (sourceData as Record<string, unknown>)?.[action.source.field]
    if (typeof val === 'string' && val.length > 0) resolvedTo = val
  }
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
