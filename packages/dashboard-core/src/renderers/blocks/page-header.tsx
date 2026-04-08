import { Button, StatusBadge } from '@manta/ui'
import React from 'react'
import { Link } from 'react-router-dom'
import type { BlockRendererProps } from './shared'
import { Heading, statusColors, Text } from './shared'

export function PageHeaderRenderer({ component, data }: BlockRendererProps) {
  const props = component.props as {
    title?: string
    titleField?: string
    descriptionField?: string
    subtitle?: string
    statusField?: string
    linkField?: string
    linkLabelField?: string
    actions?: Array<{ label: string; to?: string; variant?: string }>
  }

  // Support comma-separated titleField (e.g., 'first_name,last_name' → 'Bob Dupont')
  const title =
    props.titleField && data
      ? props.titleField
          .split(',')
          .map((f) => String(data[f.trim()] || ''))
          .filter(Boolean)
          .join(' ')
      : props.title || ''
  const description = props.descriptionField && data ? String(data[props.descriptionField] || '') : props.subtitle || ''
  const status = props.statusField && data ? String(data[props.statusField] || '') : null
  const statusColor = status ? statusColors[status] || 'grey' : null

  // External link support (e.g., link to PostHog person profile)
  const linkHref = props.linkField && data ? String(data[props.linkField] || '') : null
  const linkLabel = props.linkLabelField && data ? String(data[props.linkLabelField] || '') : null

  const actionButtons = props.actions?.map((action, i) =>
    React.createElement(
      Button,
      {
        key: i,
        variant: (action.variant as any) || 'default',
        size: 'small',
        asChild: !!action.to,
      },
      action.to ? React.createElement(Link, { to: action.to }, action.label) : action.label,
    ),
  )

  return React.createElement(
    'div',
    { className: 'flex items-center justify-between pb-8' },
    React.createElement(
      'div',
      { className: 'flex flex-col gap-y-1' },
      React.createElement(
        'div',
        { className: 'flex items-center gap-x-3' },
        React.createElement(Heading, { level: 'h1' }, title),
        status && statusColor ? React.createElement(StatusBadge, { color: statusColor }, status) : null,
      ),
      // Description: plain text or external link
      linkHref
        ? React.createElement(
            'a',
            {
              href: linkHref,
              target: '_blank',
              rel: 'noopener noreferrer',
              className: 'text-sm text-muted-foreground hover:text-foreground underline decoration-dotted underline-offset-4 transition-colors',
            },
            linkLabel || description || linkHref,
          )
        : description
          ? React.createElement(Text, { size: 'small', className: 'text-muted-foreground' }, description)
          : null,
    ),
    actionButtons && actionButtons.length > 0
      ? React.createElement('div', { className: 'flex items-center gap-x-2' }, ...actionButtons)
      : null,
  )
}
