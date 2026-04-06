import { Card } from '@manta/ui'
import React from 'react'
import { resolveDataPath } from '../../data/index'
import type { BlockRendererProps } from './shared'
import { Heading, renderActionButtons, Text } from './shared'

export function TreeListRenderer({ component, data }: BlockRendererProps) {
  const props = component.props as {
    title: string
    relation: string
    display: { primary: string }
    childrenKey: string
    actions?: Array<{ label: string; to?: string }>
    navigateTo?: string
  }

  const items = (resolveDataPath(data, props.relation) as unknown[]) || []

  function renderTree(nodes: unknown[], depth: number): React.ReactElement {
    return React.createElement(
      'div',
      { className: 'divide-y' },
      (nodes as Record<string, unknown>[]).map((node, i) =>
        React.createElement(
          'div',
          { key: (node.id as string) || i },
          React.createElement(
            'div',
            {
              className: 'flex items-center px-6 py-2.5',
              style: { paddingLeft: 24 + depth * 20 },
            },
            React.createElement(
              Text,
              {
                size: 'small',
                weight: depth === 0 ? 'plus' : 'regular',
              },
              String(resolveDataPath(node, props.display.primary) ?? '-'),
            ),
          ),
          Array.isArray(node[props.childrenKey]) && (node[props.childrenKey] as unknown[]).length > 0
            ? renderTree(node[props.childrenKey] as unknown[], depth + 1)
            : null,
        ),
      ),
    )
  }

  return React.createElement(
    Card,
    {
      className: 'divide-y p-0',
    },
    React.createElement(
      'div',
      {
        className: 'flex items-center justify-between px-6 py-4',
      },
      React.createElement(Heading, { level: 'h2' }, props.title),
      props.actions?.length
        ? React.createElement(
            'div',
            { className: 'flex items-center gap-x-2' },
            ...renderActionButtons(props.actions, data),
          )
        : null,
    ),
    items.length === 0
      ? React.createElement(
          'div',
          {
            className: 'px-6 py-6 text-center text-muted-foreground text-sm',
          },
          'No items',
        )
      : renderTree(items, 0),
  )
}
