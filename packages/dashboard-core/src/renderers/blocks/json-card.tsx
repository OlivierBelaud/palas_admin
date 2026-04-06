import { Card } from '@manta/ui'
import React from 'react'
import { resolveDataPath } from '../../data/index'
import type { BlockRendererProps } from './shared'
import { Heading } from './shared'

export function JsonCardRenderer({ component, data }: BlockRendererProps) {
  const props = component.props as { title: string; field: string }
  const value = resolveDataPath(data, props.field)

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
    ),
    React.createElement(
      'pre',
      {
        className: 'px-6 py-4 font-mono text-xs text-muted-foreground bg-muted overflow-x-auto whitespace-pre-wrap',
      },
      JSON.stringify(value, null, 2) || 'null',
    ),
  )
}
