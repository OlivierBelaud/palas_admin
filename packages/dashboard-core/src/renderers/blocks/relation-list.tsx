import { Card } from '@manta/ui'
import React from 'react'
import { resolveDataPath } from '../../data/index'
import type { BlockRendererProps } from './shared'
import { Heading, renderActionButtons, Text } from './shared'

export function RelationListRenderer({ component, data }: BlockRendererProps) {
  const props = component.props as {
    title: string
    relation: string
    display: { primary: string; secondary?: string }
    actions?: Array<{ label: string; to?: string }>
  }

  const items = (resolveDataPath(data, props.relation) as unknown[]) || []

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
    React.createElement(
      'div',
      { className: 'divide-y' },
      items.length === 0
        ? React.createElement(
            'div',
            {
              className: 'px-6 py-6 text-center text-muted-foreground text-sm',
            },
            'No items',
          )
        : (items as Record<string, unknown>[]).map((item, i) =>
            React.createElement(
              'div',
              {
                key: (item.id as string) || i,
                className: 'flex items-center justify-between px-6 py-3',
              },
              React.createElement(
                'div',
                null,
                React.createElement(
                  Text,
                  {
                    size: 'small',
                    weight: 'plus',
                  },
                  String(resolveDataPath(item, props.display.primary) ?? '-'),
                ),
                props.display.secondary
                  ? React.createElement(
                      Text,
                      {
                        size: 'small',
                        className: 'text-muted-foreground',
                      },
                      String(resolveDataPath(item, props.display.secondary) ?? ''),
                    )
                  : null,
              ),
            ),
          ),
    ),
  )
}
