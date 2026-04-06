// defineForm() — Declarative form primitive for admin dashboards.
// Forms render as overlays (FocusModal) on top of the parent route.

import type { BlockDef } from './define-page'
import type { GraphQueryDef, NamedQueryDef } from './query-types'

// ── Field ─────────────────────────────────────────────

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'select'
  | 'boolean'
  | 'date'
  | 'entity-select'
  | 'media'

export interface FieldDef {
  /** Field key — matches the entity's property name */
  key: string
  /** Display label */
  label: string
  /** Field type — determines the input component */
  type: FieldType
  /** Whether the field is required */
  required?: boolean
  /** Options for select fields */
  options?: string[]
  /** Placeholder text */
  placeholder?: string
  /** Entity name for entity-select fields */
  entity?: string
  /** Fields to display in the entity-select table (e.g., ['email', 'first_name', 'last_name']) */
  displayFields?: string[]
  /** Whether entity-select/media accepts multiple selections */
  multiple?: boolean
}

// ── Step (multi-step forms) ───────────────────────────

export interface StepDef {
  /** Step name shown in the stepper */
  name: string
  /** Simple fields — auto-rendered based on type. Use arrays to group fields on one line. */
  fields?: FieldRow[]
  /** Complex blocks — custom components for this step */
  blocks?: BlockDef[]
}

// ── Field row (single field or grouped fields on one line) ─────

/** A field row: single field (full width) or array of fields (split equally). */
export type FieldRow = FieldDef | FieldDef[]

// ── Form ──────────────────────────────────────────────

export interface FormDef {
  /** Form title shown in the modal header */
  title: string
  /** Command to execute on submit */
  command: string
  /** Query to pre-fill the form (edit mode) */
  query?: GraphQueryDef | NamedQueryDef
  /** Simple form — flat list of field rows. Use arrays to group fields on one line (50/50, 33/33/33). */
  fields?: FieldRow[]
  /** Multi-step form — each step has its own fields/blocks */
  steps?: StepDef[]
  /** Hidden fields injected into the payload on submit. Values starting with ':' resolve from route params. */
  hiddenFields?: Record<string, string | number | boolean>
}

/**
 * Define a form page (rendered as FocusModal overlay).
 *
 * Edit mode is auto-detected from the route (:id param).
 * When `query` is provided, the form pre-fills with fetched data.
 *
 * @example
 * ```typescript
 * // src/spa/admin/pages/products/create/page.ts
 * export default defineForm({
 *   title: 'Create Product',
 *   command: 'create-product',
 *   fields: [
 *     { key: 'title', label: 'Title', type: 'text', required: true },
 *     { key: 'price', label: 'Price', type: 'currency' },
 *     { key: 'status', label: 'Status', type: 'select', options: ['draft', 'active'] },
 *   ],
 * })
 * ```
 */
export function defineForm(spec: FormDef): FormDef {
  return spec
}
