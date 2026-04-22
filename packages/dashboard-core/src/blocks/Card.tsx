// Card block — generic container that wraps N child blocks inside a single
// Card. Gives the dashboard a true composition primitive: stack multiple
// DataLists, mix InfoCard + DataList, etc., all under one header. Children
// render headless (`card: false` is forced) so the outer Card owns the
// border/title/actions exactly once.

import { Button, Card, cn } from '@manta/ui'
import React from 'react'
import { Link } from 'react-router-dom'
import type { BlockDef, NamedQueryDef } from '../primitives'
import { Heading, Text } from '../renderers/blocks/shared'
import { resolveBlock } from './block-registry'
import type { DataTableBlockProps } from './DataTable'
import { useBlockQuery } from './use-block-query'

export interface CardBlockProps {
  title?: string
  /** Hide the header (title + actions) but keep the wrapper. */
  hideHeader?: boolean
  /** Optional secondary text below the title. */
  description?: string
  actions?: DataTableBlockProps['actions']
  /** Child blocks rendered stacked in the card body. */
  children: BlockDef[]
  /** How children are visually separated. Defaults to `'divider'` (matches the rest of the system). */
  separator?: 'divider' | 'none'
}

export function CardBlock(props: CardBlockProps) {
  const children = props.children ?? []
  const separator = props.separator ?? 'divider'

  const headerActions = (props.actions ?? []).map((a, i) =>
    React.createElement(CardBlockHeaderAction, { key: i, action: a }),
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
          props.description
            ? React.createElement(Text, { size: 'small', className: 'text-muted-foreground' }, props.description)
            : null,
        ),
        headerActions.length > 0
          ? React.createElement('div', { className: 'flex items-center gap-x-3 shrink-0' }, ...headerActions)
          : null,
      )

  // Render each child via the block registry. Children are forced headless
  // (no card wrapper) since this Card already owns the wrapping.
  const childNodes = children.map((child, i) => {
    const Component = resolveBlock(child.type)
    if (!Component) {
      return React.createElement(
        'div',
        {
          key: i,
          className: 'rounded-lg border border-dashed border-border p-4 text-muted-foreground text-sm',
        },
        `Unknown block type: ${child.type}`,
      )
    }
    const { type: _t, ...childProps } = child
    return React.createElement(Component, { key: i, ...childProps, card: false })
  })

  return React.createElement(
    Card,
    { className: cn('p-0 overflow-hidden', separator === 'divider' && 'divide-y') },
    header,
    ...childNodes,
  )
}

// ── Header action ─────────────────────────────────────
// Same simplified action contract as DataList/DataTable. Duplicated locally —
// a `card-shell.tsx` factor-out is tracked for later.

type CardBlockHeaderActionProps = {
  action: NonNullable<CardBlockProps['actions']>[number]
}

function CardBlockHeaderAction({ action }: CardBlockHeaderActionProps) {
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
