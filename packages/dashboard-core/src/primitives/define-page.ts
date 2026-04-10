// definePage() — Declarative page primitive for admin dashboards.
// Pages are composed of blocks. Each block owns its data query.

import type { BlockQueryDef } from './query-types'

// ── Header ────────────────────────────────────────────

export type HeaderAction =
  | 'create'
  | 'edit'
  | 'delete'
  | { label: string; command?: string; to?: string; icon?: string; destructive?: boolean }

export interface HeaderDef {
  /** Static title (listing pages) */
  title?: string
  /** Dynamic title from entity field (detail pages) */
  titleField?: string
  /** Dynamic description from entity field (displayed below title in grey) */
  descriptionField?: string
  /** Status badge from entity field */
  statusField?: string
  /** Field to render as a link (e.g. to a detail page) */
  linkField?: string
  /** Action buttons in the header */
  actions?: HeaderAction[]
}

// ── Block ─────────────────────────────────────────────

export interface BlockDef {
  /** Block type — matches a framework block or custom block name */
  type: string
  /** Data query for this block — graph query, named query, or raw HogQL against PostHog warehouse */
  query?: BlockQueryDef
  /** Block title (used by InfoCard, RelationTable, etc.) */
  title?: string
  /** Any additional block-specific props */
  [key: string]: unknown
}

// ── Page ──────────────────────────────────────────────

export interface PageDef {
  /** Page header — renders PageHeader block at the top */
  header?: HeaderDef
  /** Main content area — array of blocks */
  main: BlockDef[]
  /** Sidebar content — if present, layout switches to two-column */
  sidebar?: BlockDef[]
}

/**
 * Define a dashboard page.
 *
 * Pages are composed of blocks. Layout is inferred:
 * - `sidebar` present → two-column
 * - `sidebar` absent → single-column
 *
 * Route is determined by filesystem path (file-based routing).
 *
 * @example
 * ```typescript
 * // src/spa/admin/pages/products/page.ts
 * export default definePage({
 *   header: { title: 'Products', actions: ['create'] },
 *   main: [
 *     {
 *       type: 'DataTable',
 *       query: { graph: { entity: 'product', fields: ['title', 'status', 'price'] } },
 *       columns: [
 *         { key: 'title', label: 'Product' },
 *         { key: 'status', label: 'Status', format: 'badge' },
 *       ],
 *       navigateTo: '/admin/products/:id',
 *     },
 *   ],
 * })
 * ```
 */
export function definePage(spec: PageDef): PageDef {
  return spec
}
