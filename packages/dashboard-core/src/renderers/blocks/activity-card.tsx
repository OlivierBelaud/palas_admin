import { Card } from '@manta/ui'
import React from 'react'
import { resolveDataPath } from '../../data/index'
import type { BlockRendererProps } from './shared'
import { Heading, Text } from './shared'

export function ActivityCardRenderer({ component, data }: BlockRendererProps) {
  const props = component.props as { title: string; relation: string }
  const items = (resolveDataPath(data, props.relation) as unknown[]) || []

  return React.createElement(
    Card,
    {
      className: 'divide-y p-0',
    },
    React.createElement(
      'div',
      {
        className: 'px-6 py-4',
      },
      React.createElement(Heading, { level: 'h2' }, props.title),
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
            'No activity',
          )
        : (items as Record<string, unknown>[]).map((item, i) =>
            React.createElement(
              'div',
              {
                key: i,
                className: 'flex items-center justify-between px-6 py-3',
              },
              React.createElement(Text, { size: 'small' }, String(item.description || item.type || 'Event')),
              React.createElement(
                Text,
                {
                  size: 'small',
                  className: 'text-muted-foreground',
                },
                item.created_at ? new Date(item.created_at as string).toLocaleString() : '',
              ),
            ),
          ),
    ),
  )
}
