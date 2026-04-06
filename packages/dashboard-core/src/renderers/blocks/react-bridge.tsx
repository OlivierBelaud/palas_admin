import { Card } from '@manta/ui'
import React from 'react'
import type { BlockRendererProps } from './shared'

export function ReactBridgeRenderer({ component }: BlockRendererProps) {
  const props = component.props as {
    component: string
    fallback?: string
  }

  return React.createElement(
    Card,
    {
      className: 'p-0',
    },
    React.createElement(
      'div',
      {
        className: 'px-6 py-6 text-center text-muted-foreground text-sm',
      },
      props.fallback || `React component: ${props.component}`,
    ),
  )
}
