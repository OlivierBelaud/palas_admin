// Query types for definePage/defineForm blocks.
// Matches the backend query contracts exactly.

// ── Graph Query ───────────────────────────────────────
// Same contract as useGraphQuery() from @manta/sdk
// Same contract as query.graph() in the backend
// Requires defineQueryGraph() in the SPA's context

/**
 * Entity name type — strict, only accepts keys from MantaGeneratedEntityRegistry (camelCase).
 * If codegen hasn't run yet, run `manta dev` to generate .manta/generated.d.ts.
 */
type EntityName = keyof MantaGeneratedEntityRegistry

export interface GraphQueryDef {
  graph: {
    /** Entity to query (camelCase — e.g. 'customerGroup', NOT 'customer_group') */
    entity: EntityName
    /** Fields to return — use dotted paths for relations (e.g. 'customerCustomerGroup.customer_id') */
    fields?: string[]
    /** Relations to expand */
    relations?: string[]
    /** Filters to apply */
    filters?: Record<string, unknown>
    /** Pagination */
    pagination?: { limit?: number; offset?: number }
    /** Sort order */
    sort?: { field?: string; order?: 'asc' | 'desc' }
  }
}

// ── Named Query ───────────────────────────────────────
// Calls a defineQuery() endpoint on the backend
// Input matches the Zod schema defined in the backend

export interface NamedQueryDef {
  /** Query name — matches a defineQuery() on the backend */
  name: string
  /** Input parameters — matches the query's Zod input schema */
  input?: Record<string, unknown>
}

// ── HogQL Query ────────────────────────────────────────
// Raw HogQL SELECT query against the PostHog Data Warehouse.
// Executed server-side via the relay endpoint POST /api/admin/posthog/hogql
// (requires POSTHOG_API_KEY env var with query:read scope on the backend).
//
// Use for pure-analytics blocks in definePage specs that don't need to join
// local entities — e.g. "top campaigns by open rate", "active visitors today",
// "top PostHog events this week". For mixed local + PostHog views, write a
// defineQuery() handler that calls both.
//
// Result shape: { data: { columns: string[], rows: Record<string, unknown>[], rowCount: number } }
// The rows are already normalized as objects (column name → value) so blocks
// can consume them exactly like any other row-based result.

export interface HogQLQueryDef {
  hogql: {
    /** Raw HogQL query string — must start with SELECT or WITH. Always include a LIMIT. */
    query: string
  }
}

// ── Type guards ───────────────────────────────────────

export type BlockQueryDef = GraphQueryDef | NamedQueryDef | HogQLQueryDef

export function isGraphQuery(query: BlockQueryDef | undefined | null): query is GraphQueryDef {
  return query != null && 'graph' in query
}

export function isNamedQuery(query: BlockQueryDef | undefined | null): query is NamedQueryDef {
  return query != null && 'name' in query
}

export function isHogQLQuery(query: BlockQueryDef | undefined | null): query is HogQLQueryDef {
  return query != null && 'hogql' in query
}
