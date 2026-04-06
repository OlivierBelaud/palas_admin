import { Card, cn, Table } from '@manta/ui'
import React from 'react'
import { useNavigate } from 'react-router-dom'
import { resolveDataPath } from '../../data/index'
import type { BlockRendererProps } from './shared'
import { formatValue, Heading, renderActionButtons, renderCellValue, Text } from './shared'

export function RelationTableRenderer({ component, data }: BlockRendererProps) {
  const navigate = useNavigate()
  const props = component.props as {
    title: string
    relation: string
    columns: Array<{ key: string; label: string; type?: string }>
    actions?: Array<{ label: string; to?: string }>
    summaries?: Array<{ label: string; value: { key: string; type?: string } }>
    navigateTo?: string
  }

  const items = (resolveDataPath(data, props.relation) as unknown[]) || []

  return React.createElement(
    Card,
    {
      className: 'divide-y p-0',
    },
    // Header
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
    // Table
    React.createElement(
      Table,
      null,
      React.createElement(
        Table.Header,
        null,
        React.createElement(
          Table.Row,
          null,
          props.columns.map((col) => React.createElement(Table.HeaderCell, { key: col.key }, col.label)),
        ),
      ),
      React.createElement(
        Table.Body,
        null,
        items.length === 0
          ? React.createElement(
              Table.Row,
              null,
              React.createElement(
                Table.Cell,
                {
                  className: 'text-center py-6 text-muted-foreground',
                } as any,
                'No items',
              ),
            )
          : (items as Record<string, unknown>[]).map((item, i) =>
              React.createElement(
                Table.Row,
                {
                  key: (item.id as string) || i,
                  className: cn(props.navigateTo && 'cursor-pointer hover:bg-background-hover'),
                  onClick: props.navigateTo
                    ? () => {
                        const path = props.navigateTo!.replace(/:(\w+)/g, (_, key) =>
                          String(item[key] || item.id || ''),
                        )
                        navigate(path)
                      }
                    : undefined,
                },
                props.columns.map((col) =>
                  React.createElement(
                    Table.Cell,
                    { key: col.key },
                    renderCellValue(resolveDataPath(item, col.key), col.type),
                  ),
                ),
              ),
            ),
      ),
    ),
    // Summaries
    props.summaries
      ? React.createElement(
          'div',
          {
            className: 'bg-muted px-6 py-3',
          },
          props.summaries.map((s, i) =>
            React.createElement(
              'div',
              {
                key: i,
                className: 'flex items-center justify-between py-1',
              },
              React.createElement(
                Text,
                {
                  size: 'small',
                  className: 'text-muted-foreground',
                },
                s.label,
              ),
              React.createElement(
                Text,
                {
                  size: 'small',
                  weight: 'plus',
                },
                formatValue(resolveDataPath(data, s.value.key), s.value.type),
              ),
            ),
          ),
        )
      : null,
  )
}
