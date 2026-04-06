import { Card } from '@manta/ui'
import React from 'react'
import { resolveDataPath } from '../../data/index'
import type { BlockRendererProps } from './shared'
import { Heading, renderActionButtons, Text } from './shared'

export function MediaCardRenderer({ component, data }: BlockRendererProps) {
  const props = component.props as {
    title: string
    field: string
    actions?: Array<{ label: string; to?: string }>
  }

  const images = (resolveDataPath(data, props.field) as Array<{ url?: string }>) || []

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
      {
        className: 'grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-3 p-6',
      },
      images.length === 0
        ? React.createElement(
            Text,
            {
              size: 'small',
              className: 'text-muted-foreground col-span-full text-center py-4',
            },
            'No media',
          )
        : images.map((img, i) =>
            React.createElement(
              'div',
              {
                key: i,
                className: 'aspect-square rounded-lg border border-border overflow-hidden bg-muted',
              },
              img.url
                ? React.createElement('img', {
                    src: img.url,
                    alt: '',
                    className: 'w-full h-full object-cover',
                  })
                : React.createElement(
                    'div',
                    {
                      className: 'w-full h-full flex items-center justify-center text-muted-foreground text-xs',
                    },
                    'No image',
                  ),
            ),
          ),
    ),
  )
}
