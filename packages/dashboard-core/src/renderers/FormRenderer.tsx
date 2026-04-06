// FormRenderer — renders a defineForm() spec.
// Wraps content in FocusModal. Handles pre-fill for edit mode.
// Handles MantaError responses with field-level error display.
// Infers required fields and validates client-side from command schemas (codegen).

import { useCommand, useGraphQuery, useQuery } from '@manta/sdk'
import { Button, Input, Label, Select, Switch, Textarea, toast } from '@manta/ui'
import { useQueryClient } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { resolveBlock } from '../blocks/block-registry'
import { FocusModal } from '../components/patterns/focus-modal'
import type { FieldDef, FieldRow, FormDef } from '../primitives'
import { isGraphQuery, isNamedQuery } from '../primitives'

/** Command field metadata from codegen (optional — falls back to spec-defined required). */
export interface CommandFieldMeta {
  key: string
  required: boolean
  type: string
  checks?: string[]
  options?: string[]
}

export interface FormRendererProps {
  spec: FormDef
  customBlocks?: Record<string, ComponentType<any>>
  /** Command schemas from codegen (.manta/command-schemas.ts) — injected by the CLI entry. */
  commandSchemas?: Record<string, CommandFieldMeta[]>
}

// ── Error parsing ─────────────────────────────────────

/**
 * Parse a MantaError message into field-level errors.
 * Handles patterns like:
 * - "Key (email)=(alice@test.com) already exists." → { email: "This value already exists" }
 * - "email: Invalid email" → { email: "Invalid email" }
 * - Generic message → { _form: "message" }
 */
function parseErrorToFields(error: Error, fields: FieldDef[]): Record<string, string> {
  const message = error.message || ''
  const fieldKeys = fields.map((f) => f.key)

  // Try to parse as Zod validation error array: [{ path: ["field"], message: "..." }, ...]
  try {
    const parsed = JSON.parse(message)
    if (Array.isArray(parsed)) {
      const errors: Record<string, string> = {}
      for (const issue of parsed) {
        if (issue.path && issue.path.length > 0 && issue.message) {
          const fieldName = issue.path[0]
          if (fieldKeys.includes(fieldName)) {
            errors[fieldName] = issue.message
          }
        }
      }
      if (Object.keys(errors).length > 0) return errors
    }
  } catch {
    /* not JSON */
  }

  // Pattern: "Key (field)=(value) already exists." (unique constraint)
  const uniqueMatch = message.match(/Key \((\w+)\)=\((.+?)\) already exists/)
  if (uniqueMatch) {
    const [, fieldName, value] = uniqueMatch
    if (fieldKeys.includes(fieldName)) {
      return { [fieldName]: `"${value}" already exists` }
    }
  }

  // Pattern: "field: error message" (validation error)
  for (const key of fieldKeys) {
    const regex = new RegExp(`(?:^|\\b)${key}:\\s*(.+)`, 'i')
    const match = message.match(regex)
    if (match) {
      return { [key]: match[1].trim() }
    }
  }

  // Generic form-level error
  return { _form: message }
}

// ── EntitySelect combobox field ───────────────────────
// Inline combobox with search, dropdown results, and chips for selected items.

function EntitySelectField({
  field,
  value,
  onChange,
  error,
}: {
  field: FieldDef
  value: string[]
  onChange: (key: string, val: unknown) => void
  error?: string
}) {
  const [search, setSearch] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const entityName = field.entity ?? 'unknown'
  const displayFields = field.displayFields ?? ['email', 'name', 'title']

  // Fetch entities — always loaded so we can show selected items' labels
  const { data: entities } = useGraphQuery({ entity: entityName, pagination: { limit: 100 } })

  const items = (Array.isArray(entities) ? entities : []) as Array<{ id: string } & Record<string, unknown>>

  // Filter by search
  const filtered = React.useMemo(() => {
    if (!search.trim()) return items.filter((item) => !value.includes(item.id))
    const needle = search.toLowerCase()
    return items.filter((item) => {
      if (value.includes(item.id)) return false
      return displayFields.some((f: string) => {
        const v = item[f]
        return v != null && String(v).toLowerCase().includes(needle)
      })
    })
  }, [items, search, value, displayFields])

  // Selected items (for chips)
  const selectedItems = React.useMemo(() => items.filter((item) => value.includes(item.id)), [items, value])

  // Get display label for an item
  const getLabel = (item: Record<string, unknown>) => {
    return (
      displayFields
        .map((f: string) => item[f])
        .filter(Boolean)
        .join(' ') || String(item.id).slice(0, 8)
    )
  }

  // Close dropdown on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const addItem = (id: string) => {
    if (field.multiple) {
      onChange(field.key, [...value, id])
    } else {
      onChange(field.key, [id])
    }
    setSearch('')
  }

  const removeItem = (id: string) => {
    onChange(
      field.key,
      value.filter((v) => v !== id),
    )
  }

  return React.createElement(
    'div',
    { ref: containerRef, className: 'space-y-2' },
    // Label
    React.createElement(
      Label,
      null,
      field.label,
      field.required ? React.createElement('span', { className: 'text-muted-foreground ml-0.5' }, ' *') : null,
    ),
    // Chips for selected items
    selectedItems.length > 0
      ? React.createElement(
          'div',
          { className: 'flex flex-wrap gap-1.5' },
          ...selectedItems.map((item) =>
            React.createElement(
              'span',
              {
                key: item.id,
                className:
                  'inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-foreground',
              },
              getLabel(item),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5',
                  onClick: () => removeItem(item.id),
                },
                '\u00d7', // ×
              ),
            ),
          ),
        )
      : null,
    // Search input
    React.createElement(
      'div',
      { className: 'relative' },
      React.createElement(Input, {
        ref: inputRef,
        value: search,
        placeholder: `Search ${field.label.toLowerCase()}...`,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
          setSearch(e.target.value)
          setOpen(true)
        },
        onFocus: () => setOpen(true),
      }),
      // Dropdown results
      open && filtered.length > 0
        ? React.createElement(
            'div',
            {
              className: 'absolute z-50 mt-1 w-full rounded-md border bg-background shadow-lg max-h-60 overflow-y-auto',
            },
            ...filtered.slice(0, 20).map((item) =>
              React.createElement(
                'button',
                {
                  key: item.id,
                  type: 'button',
                  className: 'flex w-full items-center gap-3 px-3 py-2 text-sm hover:bg-accent text-left',
                  onClick: () => {
                    addItem(item.id)
                    inputRef.current?.focus()
                  },
                },
                // Show display fields as columns
                ...displayFields.map((f: string, i: number) =>
                  React.createElement(
                    'span',
                    {
                      key: f,
                      className: i === 0 ? 'font-medium text-foreground' : 'text-muted-foreground',
                    },
                    String(item[f] ?? '-'),
                  ),
                ),
              ),
            ),
          )
        : null,
      // "No results" message
      open && search.trim() && filtered.length === 0
        ? React.createElement(
            'div',
            {
              className:
                'absolute z-50 mt-1 w-full rounded-md border bg-background shadow-lg px-3 py-4 text-sm text-muted-foreground text-center',
            },
            'No results found',
          )
        : null,
    ),
    // Error
    error ? React.createElement('p', { className: 'text-sm text-destructive' }, error) : null,
  )
}

// ── Field renderer ────────────────────────────────────

function renderField(field: FieldDef, value: unknown, onChange: (key: string, val: unknown) => void, error?: string) {
  const commonProps = { key: field.key }
  const hasError = !!error
  const inputClassName = hasError ? 'border-destructive' : ''

  const errorElement = error ? React.createElement('p', { className: 'text-sm text-destructive' }, error) : null

  const labelElement = React.createElement(
    Label,
    { htmlFor: field.key, className: hasError ? 'text-destructive' : undefined },
    field.label,
    field.required ? React.createElement('span', { className: 'text-muted-foreground ml-0.5' }, ' *') : null,
  )

  switch (field.type) {
    case 'text':
    case 'currency':
    case 'number':
      return React.createElement(
        'div',
        { ...commonProps, className: 'space-y-2' },
        labelElement,
        React.createElement(Input, {
          id: field.key,
          type: field.type === 'number' || field.type === 'currency' ? 'number' : 'text',
          value: value ?? '',
          placeholder: field.placeholder ?? '',
          required: field.required,
          className: inputClassName,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            onChange(
              field.key,
              field.type === 'number' || field.type === 'currency' ? Number(e.target.value) : e.target.value,
            ),
        }),
        errorElement,
      )

    case 'textarea':
      return React.createElement(
        'div',
        { ...commonProps, className: 'space-y-2' },
        labelElement,
        React.createElement(Textarea, {
          id: field.key,
          value: value ?? '',
          placeholder: field.placeholder ?? '',
          required: field.required,
          className: inputClassName,
          onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(field.key, e.target.value),
        }),
        errorElement,
      )

    case 'select':
      return React.createElement(
        'div',
        { ...commonProps, className: 'space-y-2' },
        labelElement,
        React.createElement(
          Select,
          {
            value: String(value ?? ''),
            onValueChange: (v: string) => onChange(field.key, v),
          },
          React.createElement(
            Select.Trigger,
            { className: inputClassName },
            React.createElement(Select.Value, {
              placeholder: field.placeholder ?? `Select ${field.label.toLowerCase()}`,
            }),
          ),
          React.createElement(
            Select.Content,
            null,
            field.options?.map((opt) =>
              React.createElement(Select.Item, { key: opt, value: opt }, opt.charAt(0).toUpperCase() + opt.slice(1)),
            ),
          ),
        ),
        errorElement,
      )

    case 'entity-select':
      return React.createElement(EntitySelectField, {
        key: field.key,
        field,
        value: (value as string[]) ?? [],
        onChange,
        error,
      })

    case 'boolean':
      return React.createElement(
        'div',
        { ...commonProps, className: 'space-y-2' },
        React.createElement(
          'div',
          { className: 'flex items-center justify-between' },
          labelElement,
          React.createElement(Switch, {
            id: field.key,
            checked: !!value,
            onCheckedChange: (checked: boolean) => onChange(field.key, checked),
          }),
        ),
        errorElement,
      )

    default:
      return React.createElement(
        'div',
        { ...commonProps, className: 'space-y-2' },
        labelElement,
        React.createElement(Input, {
          id: field.key,
          value: value ?? '',
          className: inputClassName,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(field.key, e.target.value),
        }),
        errorElement,
      )
  }
}

// ── Field row renderer (single or grouped) ────────────

function renderFieldRow(
  row: FieldRow,
  index: number,
  formData: Record<string, unknown>,
  onChange: (key: string, val: unknown) => void,
  fieldErrors: Record<string, string>,
) {
  // Single field — full width
  if (!Array.isArray(row)) {
    return renderField(row, formData[row.key], onChange, fieldErrors[row.key])
  }

  // Grouped fields — equal columns
  const gridCols = row.length === 2 ? 'grid-cols-2' : row.length === 3 ? 'grid-cols-3' : 'grid-cols-1'
  return React.createElement(
    'div',
    { key: `row-${index}`, className: `grid ${gridCols} gap-4` },
    ...row.map((field) => renderField(field, formData[field.key], onChange, fieldErrors[field.key])),
  )
}

// ── Flatten field rows to get all FieldDefs (for validation) ──

function flattenFieldRows(rows?: FieldRow[]): FieldDef[] {
  if (!rows) return []
  return rows.flatMap((row) => (Array.isArray(row) ? row : [row]))
}

// ── FormRenderer ──────────────────────────────────────

export function FormRenderer({ spec, customBlocks, commandSchemas }: FormRendererProps) {
  const navigate = useNavigate()
  const params = useParams()
  const queryClient = useQueryClient()
  const command = useCommand(spec.command)
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [initialData, setInitialData] = useState<Record<string, unknown>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // Get command schema metadata (from codegen) for this command
  const schemaMeta = commandSchemas?.[spec.command]

  // Enrich a single FieldDef with required/type from command schema
  const enrichField = (field: FieldDef): FieldDef => {
    if (!schemaMeta) return field
    const meta = schemaMeta.find((m) => m.key === field.key)
    if (!meta) return field
    return { ...field, required: field.required ?? meta.required }
  }

  // Enrich field rows (preserving row grouping structure)
  const enrichedFieldRows = useMemo(() => {
    const rows = spec.fields ?? spec.steps?.flatMap((s) => s.fields ?? []) ?? []
    return rows.map((row) => {
      if (Array.isArray(row)) return row.map(enrichField)
      return enrichField(row)
    })
  }, [spec, schemaMeta])

  // Flat list of all fields (for validation)
  const enrichedFields = useMemo(() => flattenFieldRows(enrichedFieldRows), [enrichedFieldRows])

  // Edit mode: fetch existing data if query is defined
  // Supports both graph queries and named queries
  const isEditGraph = spec.query && isGraphQuery(spec.query)
  const isEditNamed = spec.query && isNamedQuery(spec.query)

  const graphConfig = isEditGraph
    ? { ...spec.query!.graph, filters: { id: params.id, ...(spec.query as any).graph.filters } }
    : { entity: '__disabled__' }
  const { data: graphData } = useGraphQuery(graphConfig, {
    enabled: !!isEditGraph && !!params.id,
  })

  // Named query for edit pre-fill — resolve :param placeholders
  const editNamedInput = isEditNamed
    ? Object.fromEntries(
        Object.entries((spec.query as any).input ?? {}).map(([k, v]: [string, unknown]) =>
          typeof v === 'string' && v.startsWith(':') && params[v.slice(1)] ? [k, params[v.slice(1)]] : [k, v],
        ),
      )
    : undefined
  const { data: namedData } = useQuery(isEditNamed ? (spec.query as any).name : '__disabled__', editNamedInput, {
    enabled: !!isEditNamed && !!params.id,
  })

  const existingData = isEditGraph ? graphData : isEditNamed ? ((namedData as any)?.data ?? namedData) : null

  // Pre-fill form with existing data
  useEffect(() => {
    if (!existingData) return
    const record = Array.isArray(existingData) ? existingData[0] : existingData
    if (record && typeof record === 'object') {
      setFormData((prev) => {
        const merged = { ...(record as Record<string, unknown>), ...prev }
        // Store initial data for diff calculation (entity-select fields)
        if (Object.keys(initialData).length === 0) {
          setInitialData({ ...(record as Record<string, unknown>) })
        }
        return merged
      })
    }
  }, [existingData])

  const close = () => navigate('..')

  const handleChange = (key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }))
    // Clear field error on change
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  /**
   * Client-side validation using command schema metadata.
   * Returns field-level errors or empty object if valid.
   */
  const validateClientSide = (): Record<string, string> => {
    const errors: Record<string, string> = {}
    if (!schemaMeta) return errors

    const hiddenKeys = new Set(Object.keys(spec.hiddenFields ?? {}))

    for (const meta of schemaMeta) {
      // Skip fields injected via hiddenFields — they aren't in formData at validation time
      // but will be populated before mutateAsync. Validating them here produces invisible errors.
      if (hiddenKeys.has(meta.key)) continue

      const value = formData[meta.key]
      const isEmpty = value === undefined || value === null || value === ''

      // Required check
      if (meta.required && isEmpty) {
        const field = enrichedFields.find((f) => f.key === meta.key)
        errors[meta.key] = `${field?.label ?? meta.key} is required`
        continue
      }

      if (isEmpty) continue

      // Type-specific checks
      if (meta.checks) {
        for (const check of meta.checks) {
          if (check === 'email' && typeof value === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            errors[meta.key] = 'Invalid email address'
          }
          if (check === 'url' && typeof value === 'string' && !/^https?:\/\//.test(value)) {
            errors[meta.key] = 'Invalid URL'
          }
          if (check.startsWith('min:')) {
            const min = Number(check.slice(4))
            if (typeof value === 'string' && value.length < min) {
              errors[meta.key] = `Minimum ${min} characters`
            }
            if (typeof value === 'number' && value < min) {
              errors[meta.key] = `Minimum value is ${min}`
            }
          }
          if (check.startsWith('max:')) {
            const max = Number(check.slice(4))
            if (typeof value === 'string' && value.length > max) {
              errors[meta.key] = `Maximum ${max} characters`
            }
            if (typeof value === 'number' && value > max) {
              errors[meta.key] = `Maximum value is ${max}`
            }
          }
        }
      }
    }

    return errors
  }

  const handleSubmit = async () => {
    setFieldErrors({})

    // Client-side validation first
    const clientErrors = validateClientSide()
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors)
      // Surface errors that don't map to a visible field (otherwise the user sees nothing)
      const visibleKeys = new Set(enrichedFields.map((f) => f.key))
      const invisible = Object.entries(clientErrors).filter(([k]) => k !== '_form' && !visibleKeys.has(k))
      if (invisible.length > 0) {
        toast.error('Validation failed', {
          description: invisible.map(([k, v]) => `${k}: ${v}`).join(', '),
        })
      }
      return
    }

    try {
      // Clean payload: remove null values and empty strings (treat as undefined for optional fields)
      const cleanData: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(formData)) {
        if (value !== null && value !== '') {
          cleanData[key] = value
        }
      }
      // For entity-select fields in edit mode, compute diff (to_add / to_remove)
      if (params.id) {
        const allFields = flattenFieldRows(enrichedFieldRows)
        for (const field of allFields) {
          if (field.type === 'entity-select' && Array.isArray(cleanData[field.key])) {
            const currentIds = cleanData[field.key] as string[]
            const originalIds = (initialData[field.key] as string[]) || []
            const toAdd = currentIds.filter((id) => !originalIds.includes(id))
            const toRemove = originalIds.filter((id) => !currentIds.includes(id))
            // Replace the flat array with diff arrays
            delete cleanData[field.key]
            if (toAdd.length > 0) cleanData[`${field.key}_to_add`] = toAdd
            if (toRemove.length > 0) cleanData[`${field.key}_to_remove`] = toRemove
          }
        }
      }

      // Inject hiddenFields — resolve :param placeholders from route params
      if (spec.hiddenFields) {
        for (const [key, value] of Object.entries(spec.hiddenFields)) {
          if (typeof value === 'string' && value.startsWith(':')) {
            const paramKey = value.slice(1)
            if (params[paramKey]) cleanData[key] = params[paramKey]
          } else {
            cleanData[key] = value
          }
        }
      }

      const payload = params.id && !spec.hiddenFields ? { id: params.id, ...cleanData } : cleanData
      await (command as any).mutateAsync(payload)
      // Invalidate all queries so the parent page refreshes with new data
      queryClient.invalidateQueries()
      close()
    } catch (err) {
      console.error('[FormRenderer] submit failed:', err)
      const errors = parseErrorToFields(err as Error, enrichedFields)
      setFieldErrors(errors)
      toast.error('Failed to save', { description: (err as Error).message || 'Unknown error' })
    }
  }

  // Form-level error (not tied to a specific field)
  const formError = fieldErrors._form
    ? React.createElement(
        'div',
        { className: 'rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive' },
        fieldErrors._form,
      )
    : null

  // Footer buttons — shared between simple and multi-step forms
  const footerElement = React.createElement(
    React.Fragment,
    null,
    React.createElement(Button, { variant: 'ghost', onClick: close }, 'Cancel'),
    React.createElement(
      Button,
      { onClick: handleSubmit, disabled: (command as any).isPending },
      (command as any).isPending ? 'Saving...' : 'Save',
    ),
  )

  // Simple form (flat fields)
  if (spec.fields) {
    return React.createElement(
      FocusModal,
      { open: true, onClose: close, title: spec.title, footer: footerElement },
      React.createElement(
        'div',
        { className: 'space-y-4' },
        formError,
        ...enrichedFieldRows.map((row, i) => renderFieldRow(row, i, formData, handleChange, fieldErrors)),
      ),
    )
  }

  // Multi-step form
  if (spec.steps) {
    return React.createElement(
      FocusModal,
      { open: true, onClose: close, title: spec.title, footer: footerElement },
      React.createElement(
        'div',
        { className: 'space-y-6' },
        formError,
        ...spec.steps.map((step, i) =>
          React.createElement(
            'div',
            { key: i, className: 'space-y-4' },
            React.createElement('h3', { className: 'text-sm font-medium text-muted-foreground' }, step.name),
            ...(step.fields?.map((row, ri) =>
              renderFieldRow(
                Array.isArray(row) ? row.map(enrichField) : enrichField(row),
                ri,
                formData,
                handleChange,
                fieldErrors,
              ),
            ) ?? []),
            ...(step.blocks
              ?.map((block, j) => {
                const BlockComponent = resolveBlock(block.type, customBlocks)
                if (!BlockComponent) return null
                const { type: _type, ...blockProps } = block
                return React.createElement(BlockComponent, { key: `block-${j}`, ...blockProps })
              })
              .filter(Boolean) ?? []),
          ),
        ),
      ),
    )
  }

  return null
}
