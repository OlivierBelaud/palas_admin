// CartSummary block — render a cart/order snapshot (thumbnails, line items, totals).
// Companion to DataTable/InfoCard — same card wrapping + actions contract.

import { Card } from '@manta/ui'
import React from 'react'
import { Skeleton } from '../components/common/skeleton'
import type { GraphQueryDef, NamedQueryDef } from '../primitives'
import { Heading, Text } from '../renderers/blocks/shared'
import { useBlockQuery } from './use-block-query'

/** Per-line cart item shape. All fields optional — renders gracefully on missing data. */
export interface CartLineItem {
  id?: string | number
  title?: string
  sku?: string
  variant_title?: string
  image_url?: string
  quantity?: number
  price?: number
  line_price?: number
  original_price?: number
  total_discount?: number
}

export interface CartSummaryBlockProps {
  query?: GraphQueryDef | NamedQueryDef
  title?: string
  /** Wrap in a Card. `true` for a minimal card, object to add `description`. */
  card?: boolean | { description?: string }
  /**
   * Key under which items live on the query result. Supports dotted paths
   * (e.g. `cart.items`). Defaults to `items`.
   */
  itemsKey?: string
  /** Which totals rows to render + their order. Defaults to a sensible cart order. */
  totals?: Array<'subtotal' | 'shipping' | 'discounts' | 'tax' | 'total'>
  /** Explicit currency code (e.g. 'EUR'). Otherwise read from `data.currency`. */
  currency?: string
  /** Hide the footer entirely when true. */
  hideTotals?: boolean
  /** Custom labels for the totals rows. */
  labels?: Partial<Record<'subtotal' | 'shipping' | 'discounts' | 'tax' | 'total' | 'empty', string>>
  actions?: Array<{
    label: string
    kind?: 'button' | 'link'
    to?: string
    source?: { name: string; input?: Record<string, unknown>; field: string }
    target?: '_blank' | '_self'
  }>
}

const DEFAULT_TOTALS: Array<'subtotal' | 'shipping' | 'discounts' | 'tax' | 'total'> = [
  'subtotal',
  'shipping',
  'discounts',
  'tax',
  'total',
]

const DEFAULT_LABELS = {
  subtotal: 'Sous-total',
  shipping: 'Livraison',
  discounts: 'Remises',
  tax: 'TVA',
  total: 'Total',
  empty: 'Aucun article',
} as const

function resolveDotted(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
      obj,
    )
}

function formatMoney(value: unknown, currency: string): string {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(n)) return '—'
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency || 'EUR' }).format(n)
  } catch {
    return `${n.toFixed(2)} ${currency}`
  }
}

export function CartSummaryBlock({ query, ...props }: CartSummaryBlockProps) {
  const { data, isLoading } = useBlockQuery(query)

  if (isLoading) return React.createElement(Skeleton, { className: 'h-64 w-full' })

  const record = (Array.isArray(data) ? {} : data) as Record<string, unknown>
  const rawItems = resolveDotted(record, props.itemsKey ?? 'items')
  const items: CartLineItem[] = Array.isArray(rawItems) ? (rawItems as CartLineItem[]) : []
  const currency = props.currency ?? (record.currency as string | undefined) ?? 'EUR'
  const labels = { ...DEFAULT_LABELS, ...(props.labels ?? {}) }

  const totalsRows = props.hideTotals ? [] : (props.totals ?? DEFAULT_TOTALS)
  const totalsValues: Record<string, unknown> = {
    subtotal: record.subtotal_price,
    shipping: record.shipping_price,
    discounts: record.discounts_amount,
    tax: record.total_tax,
    total: record.total_price,
  }

  const body = React.createElement(
    'div',
    { className: 'flex flex-col' },

    // ── Items list ──
    items.length === 0
      ? React.createElement('div', { className: 'px-6 py-10 text-center text-sm text-muted-foreground' }, labels.empty)
      : React.createElement(
          'ul',
          { className: 'divide-y divide-border/50' },
          items.map((item, i) =>
            React.createElement(
              'li',
              { key: String(item.id ?? i), className: 'flex items-center gap-x-4 px-6 py-4' },
              // Thumbnail
              React.createElement(
                'div',
                {
                  className: 'h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted flex items-center justify-center',
                },
                item.image_url
                  ? React.createElement('img', {
                      src: item.image_url,
                      alt: item.title ?? '',
                      className: 'h-full w-full object-cover',
                      loading: 'lazy',
                    })
                  : React.createElement(Text, { size: 'xsmall', className: 'text-muted-foreground' }, '—'),
              ),
              // Title + SKU + variant
              React.createElement(
                'div',
                { className: 'flex min-w-0 flex-1 flex-col gap-y-0.5' },
                React.createElement(Text, { size: 'small', weight: 'plus', className: 'truncate' }, item.title ?? '—'),
                React.createElement(
                  'div',
                  { className: 'flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground' },
                  item.sku ? React.createElement('span', null, item.sku) : null,
                  item.sku && item.variant_title ? React.createElement('span', null, '·') : null,
                  item.variant_title ? React.createElement('span', null, item.variant_title) : null,
                ),
              ),
              // Unit price
              React.createElement(
                'div',
                { className: 'shrink-0 text-right text-sm text-muted-foreground w-20' },
                formatMoney(item.price, currency),
              ),
              // Quantity
              React.createElement(
                'div',
                { className: 'shrink-0 text-right text-sm text-muted-foreground w-12' },
                `${item.quantity ?? 1}×`,
              ),
              // Line total
              React.createElement(
                'div',
                { className: 'shrink-0 text-right text-sm font-medium w-24' },
                formatMoney(
                  item.line_price ??
                    (item.price != null && item.quantity != null ? item.price * item.quantity : undefined),
                  currency,
                ),
              ),
            ),
          ),
        ),

    // ── Totals footer ──
    totalsRows.length > 0
      ? React.createElement(
          'div',
          { className: 'flex flex-col gap-y-1 border-t px-6 py-4 text-sm' },
          ...totalsRows.map((key) => {
            const value = totalsValues[key]
            if (value == null) return null
            const isTotal = key === 'total'
            return React.createElement(
              'div',
              {
                key,
                className: isTotal
                  ? 'flex justify-between pt-2 text-base font-semibold'
                  : 'flex justify-between text-muted-foreground',
              },
              React.createElement('span', null, labels[key]),
              React.createElement('span', null, formatMoney(value, currency)),
            )
          }),
        )
      : null,
  )

  if (!props.card) return body

  const cardCfg = typeof props.card === 'object' ? props.card : {}
  const headerActions = (props.actions ?? []).map((a, i) =>
    React.createElement(CartSummaryHeaderAction, { key: i, action: a }),
  )

  return React.createElement(
    Card,
    { className: 'divide-y p-0 overflow-hidden' },
    React.createElement(
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
    ),
    body,
  )
}

type CartSummaryHeaderActionProps = {
  action: NonNullable<CartSummaryBlockProps['actions']>[number]
}

function CartSummaryHeaderAction({ action }: CartSummaryHeaderActionProps) {
  const sourceQuery = action.source
    ? ({ name: action.source.name, input: action.source.input } as NamedQueryDef)
    : undefined
  const { data: sourceData } = useBlockQuery(sourceQuery)

  let resolvedTo = action.to
  if (!resolvedTo && action.source) {
    const val = (sourceData as Record<string, unknown>)?.[action.source.field]
    if (typeof val === 'string' && val.length > 0) resolvedTo = val
  }
  if (!resolvedTo) return null

  const isExternal = /^https?:\/\//.test(resolvedTo)
  const target = action.target ?? (isExternal ? '_blank' : undefined)

  if (action.kind !== 'button') {
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

  return React.createElement(
    'a',
    {
      href: resolvedTo,
      target,
      rel: target === '_blank' ? 'noopener noreferrer' : undefined,
      className:
        'inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90',
    },
    action.label,
  )
}
