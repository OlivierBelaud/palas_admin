import { Card, StatusBadge } from '@manta/ui'
import React from 'react'
import { resolveDataPath } from '../../data/index'
import type { ActionDef, ActionGroupDef, BlockRendererProps } from './shared'
import { ActionMenu, capitalizeStatus, getStatusColor, Heading, renderCellValue, Text } from './shared'

export function InfoCardRenderer({ component, data }: BlockRendererProps) {
  const props = component.props as {
    title: string
    titleField?: string
    statusField?: string
    fields: Array<{ key: string; label: string; display?: string }>
    actions?: ActionDef[]
    actionGroups?: ActionGroupDef[]
  }

  // Dynamic title from data, fallback to static title
  const displayTitle = props.titleField ? String(resolveDataPath(data, props.titleField) ?? props.title) : props.title

  // Status badge in header (if statusField is set)
  const statusValue = props.statusField ? resolveDataPath(data, props.statusField) : null

  // Build action groups: use actionGroups if provided, else wrap flat actions in a single group
  const groups: ActionGroupDef[] = props.actionGroups
    ? props.actionGroups
    : props.actions?.length
      ? [{ actions: props.actions }]
      : []

  return React.createElement(
    Card,
    {
      className: 'divide-y p-0',
    },
    // Header: title on left, status badge + action menu on right
    React.createElement(
      'div',
      {
        className: 'flex items-center justify-between px-6 py-4',
      },
      React.createElement(Heading, { level: 'h2' }, displayTitle),
      React.createElement(
        'div',
        {
          className: 'flex items-center gap-x-4',
        },
        statusValue != null
          ? React.createElement(
              StatusBadge,
              {
                color: getStatusColor(String(statusValue)),
              },
              capitalizeStatus(String(statusValue)),
            )
          : null,
        groups.length > 0 ? React.createElement(ActionMenu, { groups, data }) : null,
      ),
    ),
    // Fields as SectionRows (matches Medusa's SectionRow component)
    ...props.fields.map((field) => {
      const value = resolveDataPath(data, field.key)
      return React.createElement(
        'div',
        {
          key: field.key,
          className: 'text-muted-foreground grid w-full grid-cols-2 items-center gap-4 px-6 py-4',
        },
        React.createElement(
          Text,
          {
            size: 'small',
            weight: 'plus',
            leading: 'compact',
          },
          field.label,
        ),
        renderCellValue(value, field.display),
      )
    }),
  )
}
