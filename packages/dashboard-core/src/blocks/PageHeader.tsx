// PageHeader block — autonomous version that owns its query.
// Handles delete action with confirmation dialog.

import { useCommand } from '@manta/sdk'
import { Button, StatusBadge } from '@manta/ui'
import React, { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog } from '../components/patterns'
import type { GraphQueryDef, HeaderAction, NamedQueryDef } from '../primitives'
import { Heading, statusColors, Text } from '../renderers/blocks/shared'
import { useBlockQuery } from './use-block-query'

/** Button that executes a command with confirmation dialog */
function CommandButton({ command, label, destructive }: { command: string; label: string; destructive?: boolean }) {
  const cmd = useCommand(command)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await (cmd as any).mutateAsync({})
      window.location.reload()
    } catch {
      // Error handled by the command
    } finally {
      setLoading(false)
      setOpen(false)
    }
  }

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      Button,
      {
        size: 'small',
        variant: destructive ? ('destructive' as any) : ('default' as any),
        onClick: () => setOpen(true),
        disabled: loading,
      },
      loading ? 'En cours...' : label,
    ),
    React.createElement(ConfirmDialog, {
      open,
      onClose: () => setOpen(false),
      title: 'Confirmer',
      description: `Êtes-vous sûr de vouloir exécuter "${label}" ?`,
      onConfirm: handleConfirm,
      confirmLabel: label,
      destructive: !!destructive,
    }),
  )
}

export interface PageHeaderBlockProps {
  query?: GraphQueryDef | NamedQueryDef
  title?: string
  titleField?: string
  descriptionField?: string
  statusField?: string
  linkField?: string
  linkLabelField?: string
  actions?: HeaderAction[]
}

export function PageHeaderBlock({ query, actions, ...props }: PageHeaderBlockProps) {
  const { data } = useBlockQuery(query)
  const params = useParams()
  const navigate = useNavigate()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const record = data as Record<string, unknown>

  // Resolve title
  const title =
    props.titleField && record
      ? props.titleField
          .split(',')
          .map((f) => String(record[f.trim()] || ''))
          .filter(Boolean)
          .join(' ')
      : props.title || ''

  const description = props.descriptionField && record ? String(record[props.descriptionField] || '') : ''
  const linkHref = props.linkField && record ? String(record[props.linkField] || '') : ''
  const linkLabel = props.linkLabelField && record ? String(record[props.linkLabelField] || '') : ''
  const status = props.statusField && record ? String(record[props.statusField] || '') : null
  const statusColor = status ? (statusColors as Record<string, string>)[status] || 'grey' : null

  // Detect entity name for delete command from URL path
  // /customer-groups/:id → 'customer-group' → 'delete-customer-group'
  const location = React.useMemo(() => {
    const path = window.location.pathname
    const segments = path.split('/').filter(Boolean)
    // Find the segment before the :id param (the entity name in plural)
    // e.g., ['admin', 'customer-groups', 'abc123'] → 'customer-groups' → 'customer-group'
    const entitySegment = segments.length >= 2 ? segments[segments.length - 2] : ''
    const singular = entitySegment.endsWith('s') ? entitySegment.slice(0, -1) : entitySegment
    return singular
  }, [])

  // Delete command
  const deleteCmd = useCommand(`delete-${location}`)

  const handleDelete = async () => {
    if (!params.id) return
    try {
      await (deleteCmd as any).mutateAsync({ id: params.id })
      // Navigate to parent listing
      navigate('..')
    } catch {
      // Error handled by the command
    }
  }

  // Build action buttons
  const actionButtons = (actions ?? []).map((a, i) => {
    if (typeof a === 'string') {
      switch (a) {
        case 'create':
          return React.createElement(
            Button,
            { key: i, size: 'small', asChild: true },
            React.createElement(Link, { to: './create' }, 'Create'),
          )
        case 'edit':
          return React.createElement(
            Button,
            { key: i, size: 'small', asChild: true },
            React.createElement(Link, { to: './edit' }, 'Edit'),
          )
        case 'delete':
          return React.createElement(
            Button,
            {
              key: i,
              size: 'small',
              variant: 'destructive' as any,
              onClick: () => setDeleteOpen(true),
            },
            'Delete',
          )
        default:
          return React.createElement(Button, { key: i, size: 'small' }, a)
      }
    }
    if (a.command) {
      return React.createElement(CommandButton, { key: i, command: a.command, label: a.label, destructive: a.destructive })
    }
    if (a.to) {
      return React.createElement(
        Button,
        { key: i, size: 'small', asChild: true },
        React.createElement(Link, { to: a.to }, a.label),
      )
    }
    return React.createElement(Button, { key: i, size: 'small' }, a.label)
  })

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'div',
      { className: 'flex items-center justify-between pb-8' },
      React.createElement(
        'div',
        { className: 'flex flex-col gap-y-1' },
        React.createElement(
          'div',
          { className: 'flex items-center gap-x-3' },
          React.createElement(Heading, { level: 'h1' }, title),
          status && statusColor ? React.createElement(StatusBadge, { color: statusColor as any }, status) : null,
        ),
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
      actionButtons.length > 0
        ? React.createElement('div', { className: 'flex items-center gap-x-2' }, ...actionButtons)
        : null,
    ),
    // Delete confirmation dialog
    React.createElement(ConfirmDialog, {
      open: deleteOpen,
      onClose: () => setDeleteOpen(false),
      title: 'Are you sure?',
      description: 'This action cannot be undone.',
      onConfirm: handleDelete,
      confirmLabel: 'Delete',
      destructive: true,
    }),
  )
}
