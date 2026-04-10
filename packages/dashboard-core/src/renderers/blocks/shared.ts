import { Button, cn, DropdownMenu, IconButton, Tooltip, toast } from '@manta/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Image, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import React, { useCallback, useState } from 'react'
import ReactDOM from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { DashboardContext } from '../../context'
import { resolveDataPath } from '../../data/index'
import type { DataComponent } from '../../pages/types'

// ──────────────────────────────────────────────
// Block renderer types
// ──────────────────────────────────────────────

export type BlockRendererProps = {
  component: DataComponent
  data: Record<string, unknown>
}

export type BlockRenderer = React.ComponentType<BlockRendererProps>

// ──────────────────────────────────────────────
// Compat shims for Text/Heading (replaces @medusajs/ui)
// ──────────────────────────────────────────────

export function Text(props: {
  size?: 'xsmall' | 'small' | 'base' | 'large' | 'xlarge'
  weight?: 'regular' | 'plus'
  leading?: string
  className?: string
  children?: React.ReactNode
}) {
  const sizeClass = props.size === 'xsmall' ? 'text-xs' : props.size === 'large' ? 'text-base' : 'text-sm'
  const weightClass = props.weight === 'plus' ? 'font-medium' : ''
  return React.createElement('span', { className: cn(sizeClass, weightClass, props.className) }, props.children)
}

export function Heading(props: { level?: 'h1' | 'h2' | 'h3'; className?: string; children?: React.ReactNode }) {
  const tag = props.level || 'h2'
  const sizeClass = tag === 'h1' ? 'text-[1.75rem] font-bold tracking-tight' : 'text-lg font-semibold'
  return React.createElement(tag, { className: cn(sizeClass, props.className) }, props.children)
}

// ──────────────────────────────────────────────
// Status color mapping
// ──────────────────────────────────────────────

export const statusColors: Record<string, 'green' | 'orange' | 'red' | 'blue' | 'grey'> = {
  active: 'green',
  published: 'green',
  completed: 'green',
  captured: 'green',
  draft: 'grey',
  pending: 'orange',
  requires_action: 'orange',
  not_fulfilled: 'orange',
  archived: 'grey',
  disabled: 'grey',
  failed: 'red',
  canceled: 'red',
  refunded: 'blue',
}

export function getStatusColor(value: string): 'green' | 'orange' | 'red' | 'blue' | 'grey' {
  const lower = String(value).toLowerCase().replace(/ /g, '_')
  return statusColors[lower] || 'grey'
}

// ──────────────────────────────────────────────
// Value formatting
// ──────────────────────────────────────────────

export function formatValue(value: unknown, format?: string): string {
  if (value === null || value === undefined) return '-'
  if (Array.isArray(value)) return `${value.length} items`

  switch (format) {
    case 'badge':
      return String(value)
    case 'date':
      try {
        return new Date(value as string).toLocaleDateString()
      } catch {
        return String(value)
      }
    case 'currency':
      return typeof value === 'number'
        ? (value / 100).toLocaleString(undefined, { style: 'currency', currency: 'EUR' })
        : String(value)
    case 'boolean':
      return value ? 'True' : 'False'
    case 'number':
      return typeof value === 'number' ? value.toLocaleString() : String(value)
    case 'count':
      if (Array.isArray(value)) return String(value.length)
      return typeof value === 'number' ? String(value) : '-'
    case 'percentage':
      return typeof value === 'number' ? `${value}%` : String(value)
    default:
      return String(value)
  }
}

export function renderCellValue(value: unknown, format?: string | ColumnFormat): React.ReactNode {
  // Delegate to rich format renderer if format is an object
  if (typeof format === 'object' && format !== null) {
    return renderCellByFormat(value, format)
  }
  if (value === null || value === undefined) {
    return React.createElement(
      Text,
      {
        size: 'small',
        className: 'text-muted-foreground',
      },
      '-',
    )
  }

  if (format === 'badge') {
    const strVal = String(value)
    const label = strVal.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    // biome-ignore lint/correctness/noChildrenProp: StatusCell type requires children as prop
    return React.createElement(StatusCell, { color: getStatusColor(strVal), children: label })
  }

  if (format === 'count') {
    const count = Array.isArray(value) ? value.length : value
    return React.createElement(Text, { size: 'small' }, String(count))
  }

  if (format === 'date') {
    try {
      return React.createElement(
        Text,
        { size: 'small', className: 'text-muted-foreground' },
        new Date(value as string).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
      )
    } catch {
      return React.createElement(Text, { size: 'small' }, String(value))
    }
  }

  if (format === 'boolean') {
    return React.createElement(Text, { size: 'small' }, value ? 'Yes' : 'No')
  }

  return React.createElement(Text, { size: 'small' }, formatValue(value, format))
}

// ──────────────────────────────────────────────
// Action button helpers — shared by all card renderers
// ──────────────────────────────────────────────

export type ActionDef = {
  label: string
  icon?: string
  to?: string
  action?: string
  destructive?: boolean
  entity?: string
}

/** Resolve :param placeholders in an action path using entity data */
export function resolveActionTo(to: string, data: Record<string, unknown>): string {
  return to.replace(/:(\w+)/g, (_, key) => {
    const val = data[key] ?? data.id
    return val != null ? String(val) : key
  })
}

/** Map icon name to lucide component */
export const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Pencil,
  Trash2,
  Plus,
  MoreHorizontal,
}

export function getIcon(name?: string): React.ComponentType<{ className?: string }> | null {
  if (!name) return null
  return iconMap[name] || null
}

/** Render action buttons for a card header. Uses Link for actions with `to`, plain Button otherwise. */
export function renderActionButtons(actions: ActionDef[], data: Record<string, unknown>) {
  return actions.map((action, i) =>
    action.to
      ? React.createElement(
          Link,
          {
            key: i,
            to: resolveActionTo(action.to, data),
          },
          React.createElement(
            Button,
            {
              variant: 'secondary',
              size: 'small',
              type: 'button',
            },
            action.label,
          ),
        )
      : React.createElement(
          Button,
          {
            key: i,
            variant: 'secondary',
            size: 'small',
          },
          action.label,
        ),
  )
}

export type ActionGroupDef = { actions: ActionDef[] }

/** Render a three-dots action menu dropdown — matches Medusa's ActionMenu exactly.
 *  Groups are separated by DropdownMenu.Separator.
 *  action: "delete" + entity: "products" triggers usePrompt() + DELETE /admin/products/:id + cache invalidation. */
export function ActionMenu({ groups, data }: { groups: ActionGroupDef[]; data: Record<string, unknown> }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const dashCtx = React.useContext(DashboardContext)
  const [deleteEntity, setDeleteEntity] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const confirmDelete = useCallback(async () => {
    if (!deleteEntity) return
    const id = data.id as string
    setIsDeleting(true)
    try {
      const ds = dashCtx?.dataSource as { command?: (name: string, body: Record<string, unknown>) => Promise<unknown> }
      if (typeof ds?.command === 'function') {
        await ds.command(`delete-${deleteEntity}`, { id })
      } else {
        const endpoint = `/admin/${deleteEntity}/${id}`
        const response = await fetch(endpoint, {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        })
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      }
      queryClient.invalidateQueries()
      toast.success('Deleted successfully')
      navigate('..')
    } catch (e) {
      toast.error('Failed to delete', { description: (e as Error).message })
    } finally {
      setIsDeleting(false)
      setDeleteEntity(null)
    }
  }, [data, deleteEntity, dashCtx, queryClient, navigate])

  function getActionHandler(action: ActionDef): (() => void) | undefined {
    if (action.to) return () => navigate(resolveActionTo(action.to!, data))
    if (action.action === 'delete' && action.entity) return () => setDeleteEntity(action.entity!)
    return undefined
  }

  function renderItem(action: ActionDef, i: number) {
    const IconComp = getIcon(action.icon)
    const content = React.createElement(
      'span',
      {
        className: '[&_svg]:text-muted-foreground flex items-center gap-x-2',
      },
      IconComp ? React.createElement(IconComp, null) : null,
      React.createElement('span', null, action.label),
    )

    return React.createElement(
      DropdownMenu.Item,
      {
        key: i,
        onClick: getActionHandler(action),
      },
      content,
    )
  }

  const contentChildren: React.ReactNode[] = []
  groups.forEach((group, gi) => {
    contentChildren.push(
      React.createElement(
        DropdownMenu.Group,
        { key: `g${gi}` },
        ...group.actions.map((action, ai) => renderItem(action, ai)),
      ),
    )
    // Separator between groups, not after the last one
    if (gi < groups.length - 1) {
      contentChildren.push(React.createElement(DropdownMenu.Separator, { key: `s${gi}` }))
    }
  })

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      DropdownMenu,
      null,
      React.createElement(
        DropdownMenu.Trigger,
        { asChild: true },
        React.createElement(
          IconButton,
          {
            size: 'small',
            variant: 'transparent',
          },
          React.createElement(MoreHorizontal, null),
        ),
      ),
      React.createElement(DropdownMenu.Content, null, ...contentChildren),
    ),
    // Delete confirmation dialog
    deleteEntity
      ? ReactDOM.createPortal(
          React.createElement(
            'div',
            { className: 'fixed inset-0 z-50 flex items-center justify-center' },
            React.createElement('div', {
              className: 'fixed inset-0 bg-black/80',
              onClick: () => setDeleteEntity(null),
            }),
            React.createElement(
              'div',
              {
                className: 'relative z-50 grid w-full max-w-lg gap-4 border bg-background p-6 shadow-lg sm:rounded-lg',
              },
              React.createElement(
                'div',
                { className: 'flex flex-col space-y-2 text-center sm:text-left' },
                React.createElement('h2', { className: 'text-lg font-semibold' }, 'Are you sure?'),
                React.createElement(
                  'p',
                  { className: 'text-sm text-muted-foreground' },
                  `You are about to delete${(data.title ?? data.name ?? data.email) ? ` "${data.title ?? data.name ?? data.email}"` : ' this record'}. This action cannot be undone.`,
                ),
              ),
              React.createElement(
                'div',
                { className: 'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2' },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    disabled: isDeleting,
                    onClick: () => setDeleteEntity(null),
                    className:
                      'inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-semibold hover:bg-accent hover:text-accent-foreground',
                  },
                  'Cancel',
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    disabled: isDeleting,
                    onClick: confirmDelete,
                    className:
                      'inline-flex h-10 items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90',
                  },
                  isDeleting ? 'Deleting...' : 'Delete',
                ),
              ),
            ),
          ),
          document.body,
        )
      : null,
  )
}

/** Capitalize first letter of each word, replace underscores with spaces */
export function capitalizeStatus(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// ──────────────────────────────────────────────
// Thumbnail — matches Medusa's Thumbnail component
// ──────────────────────────────────────────────

export function Thumbnail({ src, size = 'base' }: { src?: string | null; size?: 'base' | 'small' }) {
  const sizeClass = size === 'small' ? 'h-5 w-4' : 'h-8 w-6'
  return React.createElement(
    'div',
    {
      className: cn(
        'bg-muted flex items-center justify-center overflow-hidden rounded border border-border',
        sizeClass,
      ),
    },
    src
      ? React.createElement('img', {
          src,
          alt: '',
          className: 'h-full w-full object-cover object-center',
        })
      : React.createElement(Image, { className: 'text-muted-foreground' }),
  )
}

// ──────────────────────────────────────────────
// StatusCell — colored dot + text (matches Medusa exactly)
// ──────────────────────────────────────────────

export function StatusCell({ color, children }: { color: string; children: string }) {
  const colorClasses: Record<string, string> = {
    grey: 'bg-gray-400',
    green: 'bg-green-500',
    red: 'bg-red-500',
    blue: 'bg-blue-500',
    orange: 'bg-orange-500',
    purple: 'bg-purple-500',
  }

  return React.createElement(
    'div',
    {
      className: 'text-sm text-muted-foreground flex h-full w-full items-center gap-x-2 overflow-hidden',
    },
    React.createElement(
      'div',
      {
        role: 'presentation',
        className: 'flex h-5 w-2 items-center justify-center',
      },
      React.createElement('div', {
        className: cn(
          'h-2 w-2 rounded-sm shadow-[0px_0px_0px_1px_rgba(0,0,0,0.12)_inset]',
          colorClasses[color] || colorClasses.grey,
        ),
      }),
    ),
    React.createElement('span', { className: 'truncate' }, children),
  )
}

// ──────────────────────────────────────────────
// Icon map for row actions
// ──────────────────────────────────────────────

export function getActionIcon(icon?: string): React.ReactNode {
  switch (icon) {
    case 'pencil':
      return React.createElement(Pencil, null)
    case 'trash':
      return React.createElement(Trash2, null)
    case 'plus':
      return React.createElement(Plus, null)
    default:
      return null
  }
}

// ──────────────────────────────────────────────
// PlaceholderCell — renders "-" dash for empty values (matches Medusa)
// ──────────────────────────────────────────────

export function PlaceholderCell() {
  return React.createElement(
    'span',
    {
      className: 'text-sm text-muted-foreground',
    },
    '-',
  )
}

// ──────────────────────────────────────────────
// Cell renderers for EntityTable columns
// ──────────────────────────────────────────────

export function renderCellByType(
  col: { key: string; label: string; type?: string; format?: ColumnFormat; thumbnailKey?: string },
  item: Record<string, unknown>,
): React.ReactNode {
  const value = resolveDataPath(item, col.key)

  // Use rich format if provided (from definePage columns)
  if (col.format) {
    return renderCellByFormat(value, col.format)
  }

  switch (col.type) {
    case 'thumbnail': {
      const thumbSrc = col.thumbnailKey ? (resolveDataPath(item, col.thumbnailKey) as string | null) : null
      return React.createElement(
        'div',
        {
          className: 'flex h-full w-full max-w-[250px] items-center gap-x-3 overflow-hidden',
        },
        React.createElement(
          'div',
          { className: 'w-fit flex-shrink-0' },
          React.createElement(Thumbnail, { src: thumbSrc }),
        ),
        React.createElement(
          'span',
          {
            className: 'truncate',
            title: String(value ?? ''),
          },
          String(value ?? '-'),
        ),
      )
    }

    case 'badge': {
      if (value == null) return React.createElement(PlaceholderCell, null)
      const strVal = String(value)
      // Capitalize first letter of each word, replace underscores with spaces (matches Medusa)
      const label = strVal.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      return React.createElement(StatusCell, {
        color: getStatusColor(strVal),
        // biome-ignore lint/correctness/noChildrenProp: StatusCell type requires children as prop
        children: label,
      })
    }

    case 'count': {
      if (Array.isArray(value)) {
        if (value.length === 0) return React.createElement(PlaceholderCell, null)
        return React.createElement('span', { className: 'text-sm' }, String(value.length))
      }
      if (value == null) return React.createElement(PlaceholderCell, null)
      return React.createElement(
        'span',
        {
          className: 'text-sm',
        },
        String(value),
      )
    }

    case 'list-count': {
      if (!Array.isArray(value) || value.length === 0) {
        return React.createElement(PlaceholderCell, null)
      }
      const names = (value as Array<Record<string, unknown>>).map((v) =>
        String(v.name || v.title || v.label || v.id || ''),
      )
      if (names.length <= 2) {
        return React.createElement(
          'span',
          {
            className: 'text-sm truncate',
            title: names.join(', '),
          },
          names.join(', '),
        )
      }
      return React.createElement(
        'div',
        {
          className: 'flex items-center gap-x-1 text-sm',
        },
        React.createElement('span', { className: 'truncate' }, names.slice(0, 2).join(', ')),
        React.createElement(Tooltip, {
          content: React.createElement(
            'ul',
            { className: 'list-none p-0 m-0' },
            names.slice(2).map((n, i) => React.createElement('li', { key: i }, n)),
          ),
          // biome-ignore lint/correctness/noChildrenProp: Tooltip type requires children as prop
          children: React.createElement(
            'span',
            {
              className: 'text-muted-foreground whitespace-nowrap cursor-default',
            },
            `+${names.length - 2} more`,
          ),
        }),
      )
    }

    case 'display-id': {
      if (value == null) return React.createElement(PlaceholderCell, null)
      return React.createElement(
        'span',
        {
          className: 'text-sm',
        },
        `#${value}`,
      )
    }

    case 'customer-name': {
      if (typeof value === 'object' && value !== null) {
        const customer = value as Record<string, unknown>
        const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ')
        return React.createElement(
          'span',
          {
            className: 'text-sm truncate',
          },
          name || String(customer.email || '-'),
        )
      }
      const name = [item.first_name, item.last_name].filter(Boolean).join(' ')
      return React.createElement(
        'span',
        {
          className: 'text-sm truncate',
        },
        name || String(item.email || value || '-'),
      )
    }

    case 'currency': {
      if (value == null) return React.createElement(PlaceholderCell, null)
      const amount =
        typeof value === 'number'
          ? (value / 100).toLocaleString(undefined, { style: 'currency', currency: 'EUR' })
          : String(value)
      return React.createElement(
        'span',
        {
          className: 'text-sm font-medium tabular-nums text-foreground/70',
        },
        amount,
      )
    }

    case 'date': {
      if (value == null) return React.createElement(PlaceholderCell, null)
      try {
        return React.createElement(
          'span',
          {
            className: 'text-sm text-muted-foreground',
          },
          new Date(value as string).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }),
        )
      } catch {
        return React.createElement('span', { className: 'text-sm text-muted-foreground' }, String(value))
      }
    }

    case 'number': {
      if (value == null) return React.createElement(PlaceholderCell, null)
      return React.createElement(
        'span',
        {
          className: 'text-sm font-medium tabular-nums',
        },
        typeof value === 'number' ? value.toLocaleString() : String(value),
      )
    }

    case 'boolean': {
      return React.createElement(
        'span',
        {
          className: 'text-sm text-foreground/70',
        },
        value ? 'Yes' : 'No',
      )
    }

    default: {
      if (value == null) return React.createElement(PlaceholderCell, null)
      if (Array.isArray(value)) {
        return React.createElement(
          'span',
          {
            className: 'text-sm text-muted-foreground',
          },
          `${value.length}`,
        )
      }
      return React.createElement(
        'span',
        {
          className: 'text-sm truncate text-muted-foreground',
          title: String(value),
        },
        String(value),
      )
    }
  }
}

// ──────────────────────────────────────────────
// Rich cell formatting for definePage() columns
// ──────────────────────────────────────────────

/**
 * Column format — string shortcut or parameterized object.
 *
 * String shortcuts: 'text', 'highlight', 'badge', 'boolean', 'date', 'currency', 'number'
 * Object formats: { type: 'badge', true: { label, color }, false: { label, color } }
 *                 { type: 'badge', values: { active: 'green', draft: 'grey' } }
 *                 { type: 'currency', currency: 'USD' }
 *                 { type: 'date', format: 'relative' }
 */
export type ColumnFormat =
  | string
  | {
      type: 'badge'
      true?: { label?: string; color?: string }
      false?: { label?: string; color?: string }
      values?: Record<string, string>
    }
  | { type: 'currency'; currency?: string }
  | { type: 'date'; format?: 'relative' | 'short' | 'long' }
  | { type: 'highlight' }

export function renderCellByFormat(value: unknown, format?: ColumnFormat): React.ReactNode {
  if (value == null && format !== 'boolean' && (typeof format !== 'object' || format?.type !== 'badge')) {
    return React.createElement(PlaceholderCell, null)
  }

  // No format — default text
  if (!format) {
    if (value == null) return React.createElement(PlaceholderCell, null)
    return React.createElement(
      'span',
      { className: 'text-sm truncate text-muted-foreground', title: String(value) },
      String(value),
    )
  }

  // String shortcut
  if (typeof format === 'string') {
    switch (format) {
      case 'highlight':
        return React.createElement('span', { className: 'text-sm font-medium text-foreground' }, String(value ?? '-'))

      case 'badge': {
        if (value == null) return React.createElement(PlaceholderCell, null)
        const strVal = String(value)
        const label = strVal.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        // biome-ignore lint/correctness/noChildrenProp: StatusCell type requires children as prop
        return React.createElement(StatusCell, { color: getStatusColor(strVal), children: label })
      }

      case 'boolean':
        return React.createElement('span', { className: 'text-sm text-foreground/70' }, value ? 'Yes' : 'No')

      case 'date': {
        if (value == null) return React.createElement(PlaceholderCell, null)
        try {
          return React.createElement(
            'span',
            { className: 'text-sm text-muted-foreground' },
            new Date(value as string).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            }),
          )
        } catch {
          return React.createElement('span', { className: 'text-sm text-muted-foreground' }, String(value))
        }
      }

      case 'currency': {
        if (value == null) return React.createElement(PlaceholderCell, null)
        const amount =
          typeof value === 'number'
            ? (value / 100).toLocaleString(undefined, { style: 'currency', currency: 'EUR' })
            : String(value)
        return React.createElement('span', { className: 'text-sm font-medium tabular-nums text-foreground/70' }, amount)
      }

      case 'number': {
        if (value == null) return React.createElement(PlaceholderCell, null)
        return React.createElement(
          'span',
          { className: 'text-sm font-medium tabular-nums' },
          typeof value === 'number' ? value.toLocaleString() : String(value),
        )
      }

      default:
        // Unknown string format — treat as text
        return React.createElement(
          'span',
          { className: 'text-sm truncate text-muted-foreground', title: String(value) },
          String(value ?? '-'),
        )
    }
  }

  // Object format
  switch (format.type) {
    case 'badge': {
      // Boolean badge with custom labels/colors
      if ('true' in format || 'false' in format) {
        const boolVal = !!value
        const config = boolVal ? format.true : format.false
        const label = config?.label ?? (boolVal ? 'Yes' : 'No')
        const color = config?.color ?? (boolVal ? 'green' : 'grey')
        // biome-ignore lint/correctness/noChildrenProp: StatusCell type requires children as prop
        return React.createElement(StatusCell, { color, children: label })
      }

      // Enum badge with value→color mapping
      if (format.values) {
        if (value == null) return React.createElement(PlaceholderCell, null)
        const strVal = String(value)
        const color = format.values[strVal] ?? format.values[strVal.toLowerCase()] ?? 'grey'
        const label = strVal.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        // biome-ignore lint/correctness/noChildrenProp: StatusCell type requires children as prop
        return React.createElement(StatusCell, { color, children: label })
      }

      // Default badge
      if (value == null) return React.createElement(PlaceholderCell, null)
      const strVal = String(value)
      const label = strVal.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      // biome-ignore lint/correctness/noChildrenProp: StatusCell type requires children as prop
      return React.createElement(StatusCell, { color: getStatusColor(strVal), children: label })
    }

    case 'currency': {
      if (value == null) return React.createElement(PlaceholderCell, null)
      const currency = format.currency ?? 'EUR'
      const amount =
        typeof value === 'number'
          ? (value / 100).toLocaleString(undefined, { style: 'currency', currency })
          : String(value)
      return React.createElement('span', { className: 'text-sm font-medium tabular-nums text-foreground/70' }, amount)
    }

    case 'date': {
      if (value == null) return React.createElement(PlaceholderCell, null)
      try {
        if (format.format === 'relative') {
          const diff = Date.now() - new Date(value as string).getTime()
          const minutes = Math.floor(diff / 60000)
          if (minutes < 1)
            return React.createElement('span', { className: 'text-sm text-muted-foreground' }, 'Just now')
          if (minutes < 60)
            return React.createElement('span', { className: 'text-sm text-muted-foreground' }, `${minutes}m ago`)
          const hours = Math.floor(minutes / 60)
          if (hours < 24)
            return React.createElement('span', { className: 'text-sm text-muted-foreground' }, `${hours}h ago`)
          const days = Math.floor(hours / 24)
          return React.createElement('span', { className: 'text-sm text-muted-foreground' }, `${days}d ago`)
        }
        const options: Intl.DateTimeFormatOptions =
          format.format === 'long'
            ? { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
            : { year: 'numeric', month: 'short', day: 'numeric' }
        return React.createElement(
          'span',
          { className: 'text-sm text-muted-foreground' },
          new Date(value as string).toLocaleDateString(undefined, options),
        )
      } catch {
        return React.createElement('span', { className: 'text-sm text-muted-foreground' }, String(value))
      }
    }

    case 'highlight':
      return React.createElement('span', { className: 'text-sm font-medium text-foreground' }, String(value ?? '-'))

    default:
      return React.createElement('span', { className: 'text-sm truncate text-muted-foreground' }, String(value ?? '-'))
  }
}
