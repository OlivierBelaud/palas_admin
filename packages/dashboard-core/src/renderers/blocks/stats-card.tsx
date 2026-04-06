import { Card } from '@manta/ui'
import React from 'react'
import { resolveDataPath } from '../../data/index'
import type { BlockRendererProps } from './shared'
import { formatValue, Heading, Text } from './shared'

export function StatsCardRenderer({ component, data }: BlockRendererProps) {
  const props = component.props as {
    title: string
    metrics: Array<{ label: string; key: string; format?: string }>
  }

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
      {
        className: 'grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4 p-6',
      },
      props.metrics.map((metric, i) =>
        React.createElement(
          'div',
          {
            key: i,
            className: 'flex flex-col gap-y-1',
          },
          React.createElement(
            Text,
            {
              size: 'xsmall',
              className: 'text-muted-foreground',
              weight: 'plus',
            },
            metric.label,
          ),
          React.createElement(
            Text,
            {
              size: 'xlarge',
              weight: 'plus',
            },
            formatValue(resolveDataPath(data, metric.key), metric.format),
          ),
        ),
      ),
    ),
  )
}
