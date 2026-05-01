// @ts-nocheck — AI SDK tools are dynamically loaded via require('ai'), types are unresolvable at compile time
// AI Chat handler — registered as POST /admin/ai/chat by the bootstrap.
// Uses Vercel AI SDK with multi-provider support.
// Tools: CQRS commands + data queries + dashboard modifications.

import type { CommandRegistry, MantaApp, QueryRegistry } from '@manta/core'
import { getRequestBody } from '../server-bootstrap'

// ── PostHog Data Warehouse tables cache ─────────────────────────
//
// On first request (and every 5 minutes thereafter) we fetch the list of warehouse tables
// + their column schemas from the PostHog REST API and inject them into the system prompt.
// This lets the AI write analytics queries against Klaviyo / Shopify / Stripe / etc. without
// needing to sample rows to discover column names — it already knows the schema upfront.
//
// Requires POSTHOG_API_KEY with scope `warehouse_table:read` on the personal API key.
// Silently skipped if the scope is missing or the key isn't set.

interface WarehouseCache {
  promptSection: string
  expiresAt: number
}
let _warehouseCache: WarehouseCache | null = null
const WAREHOUSE_CACHE_TTL_MS = 5 * 60 * 1000

async function getWarehouseIndexSection(): Promise<string | null> {
  if (!process.env.POSTHOG_API_KEY) return null

  const now = Date.now()
  if (_warehouseCache && _warehouseCache.expiresAt > now) {
    return _warehouseCache.promptSection
  }

  try {
    const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
    const key = process.env.POSTHOG_API_KEY
    const res = await fetch(`${host}/api/projects/@current/warehouse_tables/`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      results?: Array<{
        name: string
        columns?: Array<{ name: string; type: string }>
        source?: { source_type?: string } | null
      }>
    }
    const tables = data.results ?? []
    if (tables.length === 0) return null

    // Group by source type (klaviyo, shopify, stripe, manual, …) for readability
    const bySource = new Map<
      string,
      Array<{ dotted: string; raw: string; columns: Array<{ name: string; type: string }> }>
    >()
    for (const t of tables) {
      const rawName = t.name
      // REST returns 'klaviyo_events', HogQL also accepts 'klaviyo.events' — prefer the dotted
      // form since it's what PostHog UI displays in its sidebar and matches the schema.table
      // mental model.
      const firstUnderscore = rawName.indexOf('_')
      const dotted =
        firstUnderscore > 0 ? `${rawName.slice(0, firstUnderscore)}.${rawName.slice(firstUnderscore + 1)}` : rawName
      const source = t.source?.source_type ?? 'manual'
      const list = bySource.get(source) ?? []
      list.push({ dotted, raw: rawName, columns: t.columns ?? [] })
      bySource.set(source, list)
    }

    const lines: string[] = []
    lines.push('## Available PostHog Data Warehouse tables (auto-discovered)')
    lines.push('')
    lines.push(`The following tables are synced in this project's PostHog warehouse. Query them with`)
    lines.push('`query_posthog_hogql` using either the dotted form (`klaviyo.events`) or the underscore')
    lines.push('form (`klaviyo_events`) — HogQL accepts both. **Column names and types are listed below,')
    lines.push('so you do NOT need to sample rows with `SELECT * LIMIT 1` to discover columns for these')
    lines.push('tables.** Just write your analytics query directly using the listed columns.')
    lines.push('')
    for (const [source, list] of bySource) {
      lines.push(`### Source: ${source}`)
      lines.push('')
      for (const t of list) {
        const colsStr = t.columns.map((c) => `${c.name}:${c.type}`).join(', ')
        lines.push(`- \`${t.dotted}\` (aka \`${t.raw}\`, ${t.columns.length} cols) — ${colsStr}`)
      }
      lines.push('')
    }
    lines.push('**Cross-source joins** are supported in HogQL. Example: correlate Klaviyo clicks with')
    lines.push('PostHog checkout events by joining on email or distinct_id.')

    const section = lines.join('\n')
    _warehouseCache = {
      promptSection: section,
      expiresAt: now + WAREHOUSE_CACHE_TTL_MS,
    }
    return section
  } catch {
    return null
  }
}

// ── Provider config ──────────────────────────────────────────────

type ProviderName = 'anthropic' | 'openai' | 'google' | 'mistral'

const PROVIDER_DEFAULTS: Record<ProviderName, { envKey: string; model: string }> = {
  anthropic: { envKey: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-20250514' },
  openai: { envKey: 'OPENAI_API_KEY', model: 'gpt-4o' },
  google: { envKey: 'GOOGLE_GENERATIVE_AI_API_KEY', model: 'gemini-2.0-flash' },
  mistral: { envKey: 'MISTRAL_API_KEY', model: 'mistral-large-latest' },
}

async function getModel() {
  const providerName = (process.env.MANTA_AI_PROVIDER || 'anthropic') as ProviderName
  const config = PROVIDER_DEFAULTS[providerName]
  if (!config) throw new Error(`Unknown AI provider: ${providerName}. Use: anthropic, openai, google, mistral`)

  const apiKey = process.env[config.envKey]
  if (!apiKey) throw new Error(`${config.envKey} not configured`)

  const modelId = process.env.MANTA_AI_MODEL || config.model

  switch (providerName) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic({ apiKey })(modelId)
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({ apiKey })(modelId)
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return createGoogleGenerativeAI({ apiKey })(modelId)
    }
    case 'mistral': {
      const { createMistral } = await import('@ai-sdk/mistral')
      return createMistral({ apiKey })(modelId)
    }
  }
}

// ── Schema introspection ─────────────────────────────────────────

interface FieldSchema {
  name: string
  type: string
  nullable?: boolean
  primaryKey?: boolean
  values?: unknown
  default?: unknown
}

interface RelationSchema {
  name: string
  type: string
  target: string
}

interface LinkSchema {
  linkedEntity: string
  linkedModule: string
  description: string
}

interface EntitySchema {
  name: string
  fields: FieldSchema[]
  relations: RelationSchema[]
  links: LinkSchema[]
  commands: string[]
}

/**
 * Extract a structured schema from a DmlEntity instance.
 * Parses each property via .parse() to get type, nullable, enum values, etc.
 */
function extractEntitySchema(
  entity: { name: string; schema: Record<string, unknown> },
  compensableMethods: string[] = [],
  links: LinkSchema[] = [],
): EntitySchema {
  const fields: FieldSchema[] = []
  const relations: RelationSchema[] = []

  for (const [name, value] of Object.entries(entity.schema)) {
    const v = value as Record<string, unknown>

    // Relation — has __dmlRelation: true
    if (v?.__dmlRelation === true) {
      let targetName = '?'
      try {
        const target = v.target?.()
        targetName = target?.name ?? '?'
      } catch {
        /* lazy ref may fail */
      }
      relations.push({ name, type: v.type, target: targetName })
      continue
    }

    // Property — has .parse() method (BaseProperty, NullableModifier, PrimaryKeyModifier)
    if (typeof v?.parse === 'function') {
      try {
        const meta = v.parse(name)
        const field: FieldSchema = { name, type: meta.dataType?.name ?? 'unknown' }
        if (meta.nullable) field.nullable = true
        if (meta.primaryKey) field.primaryKey = true
        if (meta.values) field.values = meta.values
        if (meta.defaultValue !== undefined) field.default = meta.defaultValue
        fields.push(field)
      } catch {
        fields.push({ name, type: 'unknown' })
      }
    }
  }

  return { name: entity.name, fields, relations, links, commands: compensableMethods }
}

// ── Tools ────────────────────────────────────────────────────────

function buildTools(
  app: MantaApp,
  moduleNames: string[],
  linkGraph: LinkGraphEntry[],
  navigationOverride?: unknown[],
  defaultNavigation?: unknown[],
) {
  // Lazy import — AI SDK is optional
  const z = require('zod') as typeof import('zod')
  const { tool } = require('ai') as { tool: (...args: unknown[]) => unknown }

  // Anthropic (and most providers) require tool names to match ^[a-zA-Z0-9_-]{1,64}$.
  // Command names can legitimately contain ':' (module-scoped like `posthog:track-event`)
  // or '.' (entity commands like `catalog.create-product`). Normalize any non-alphanumeric,
  // non-underscore character to '_'. Without this, streamText emits a silent error frame
  // ("3:An error occurred.") and the AI panel appears broken.
  const sanitizeToolName = (name: string) => name.replace(/[^a-zA-Z0-9_]/g, '_')

  // Discover available commands from registry (explicit defineCommand files)
  const commandTools: Record<string, unknown> = {}
  try {
    const registry = app.resolve<CommandRegistry>('commandRegistry')
    for (const entry of registry.list()) {
      const cmdName = `command_${sanitizeToolName(entry.name)}`
      commandTools[cmdName] = tool({
        description: entry.description,
        parameters: entry.inputSchema,
        execute: async (input: unknown) => {
          const callable = (app.commands as Record<string, ((...args: unknown[]) => Promise<unknown>) | undefined>)[
            entry.name
          ]
          if (!callable) return { error: `Command "${entry.name}" not found` }
          try {
            const result = await callable(input)
            return { success: true, data: result }
          } catch (err) {
            return { error: (err as Error).message }
          }
        },
      })
    }
  } catch {
    /* no command registry */
  }

  // Also expose auto-generated entity commands (CRUD + link/unlink)
  try {
    const entityCmdRegistry =
      app.resolve<Map<string, { name: string; description: string; input: import('zod').ZodType }>>(
        '__entityCommandRegistry',
      )
    for (const [cmdName, entityCmd] of entityCmdRegistry.entries()) {
      const toolName = `command_${sanitizeToolName(cmdName)}`
      if (commandTools[toolName]) continue // explicit command already registered (override)
      commandTools[toolName] = tool({
        description: entityCmd.description,
        parameters: entityCmd.input,
        execute: async (input: unknown) => {
          const callable = (app.commands as Record<string, ((...args: unknown[]) => Promise<unknown>) | undefined>)[
            cmdName
          ]
          if (!callable) return { error: `Command "${cmdName}" not found` }
          try {
            const result = await callable(input)
            return { success: true, data: result }
          } catch (err) {
            return { error: (err as Error).message }
          }
        },
      })
    }
  } catch {
    /* no entity command registry */
  }

  // Discover available queries from registry (defineQuery files — CQRS reads)
  const queryTools: Record<string, unknown> = {}
  try {
    const queryRegistry = app.resolve<QueryRegistry>('queryRegistry')
    for (const entry of queryRegistry.list()) {
      const toolName = `query_${entry.name.replace(/[-:]/g, '_')}`
      queryTools[toolName] = tool({
        description: entry.description,
        parameters: entry.input,
        execute: async (input: unknown) => {
          try {
            const result = await entry.handler(input, {
              query: app.resolve('queryService'),
              log: (app as unknown as { logger?: unknown }).logger ?? console,
              auth: null,
              headers: {},
            })
            return { success: true, data: result }
          } catch (err) {
            return { error: (err as Error).message }
          }
        },
      })
    }
  } catch {
    /* no query registry */
  }

  return {
    // ── Data tools (CQRS query) ──────────────────────────────────

    query_entity: tool({
      description: `Query entities. Returns { data: [...], count: number }.

Entities (camelCase): ${moduleNames.join(', ')}

To include relations, add the relation name to fields:
  query_entity({ entity: "customerGroup", fields: ["name", "customers"] })
  → Each result includes a "customers" array with linked entities.
  Count the array length to get the count.

Relations: ${linkGraph
        .map((l) => {
          const isMany = l.cardinality === 'M:N'
          return `${l.left} → ${isMany ? `${l.right}s` : l.right}, ${l.right} → ${isMany ? `${l.left}s` : l.left}`
        })
        .join('; ')}`,
      parameters: z.object({
        entity: z.string().describe(`Entity name (camelCase). Available: ${moduleNames.join(', ')}`),
        fields: z
          .array(z.string())
          .optional()
          .describe(
            'Fields to return. Add relation names to include related entities (e.g. ["name", "customers"]). Omit for all fields.',
          ),
        filters: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
          .optional()
          .describe(
            'Filter conditions. Exact match: { status: "active" }. Multiple values (IN): { status: ["active", "archived"] }. NO operators like $ne, $gt, $in — only plain values or arrays.',
          ),
        limit: z.number().optional().describe('Max results (default 20)'),
        offset: z.number().optional().describe('Pagination offset'),
        sort: z.string().optional().describe('Sort field, prefix with - for desc (e.g. "-created_at")'),
      }),
      execute: async ({ entity, fields, filters, limit, offset, sort }) => {
        try {
          const queryService = app.resolve<{ graph: Function; graphAndCount: Function }>('queryService')
          if (queryService && typeof queryService.graphAndCount === 'function') {
            const sortObj = sort
              ? { [sort.startsWith('-') ? sort.slice(1) : sort]: sort.startsWith('-') ? 'desc' : 'asc' }
              : undefined
            const [data, count] = await queryService.graphAndCount({
              entity,
              fields,
              filters,
              sort: sortObj,
              pagination: { limit: limit ?? 20, offset: offset ?? 0 },
            })
            return { data, count }
          }
        } catch (queryErr) {
          // Log the error — don't silently swallow it
          console.error(`[AI query_entity] graphAndCount failed for "${entity}":`, (queryErr as Error).message)
          // Fall back to service.list()
        }

        // Fallback: direct service.list() for modules without Query Graph
        let service: Record<string, unknown> | null = null
        try {
          service = app.resolve<Record<string, unknown>>(`${entity}ModuleService`)
        } catch {
          try {
            service = (app.modules as Record<string, Record<string, unknown> | undefined>)[entity] ?? null
          } catch {
            /* not found */
          }
        }
        if (!service || typeof service.list !== 'function') {
          return { error: `Entity "${entity}" not found. Available: ${moduleNames.join(', ')}` }
        }

        let data = (await (service.list as () => Promise<unknown[]>)()) as Record<string, unknown>[]

        // Filters
        if (filters) {
          for (const [key, value] of Object.entries(filters)) {
            if (Array.isArray(value)) {
              data = data.filter((item) => value.includes(String(item[key])))
            } else if (value !== undefined && value !== null) {
              data = data.filter((item) => String(item[key]) === String(value))
            }
          }
        }

        // Sort
        if (sort) {
          const desc = sort.startsWith('-')
          const field = desc ? sort.slice(1) : sort
          data.sort((a, b) => {
            const va = a[field] ?? ''
            const vb = b[field] ?? ''
            if (typeof va === 'number' && typeof vb === 'number') return desc ? vb - va : va - vb
            return desc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb))
          })
        }

        const count = data.length
        const sliced = data.slice(offset ?? 0, (offset ?? 0) + (limit ?? 20))
        return { data: sliced, count }
      },
    }),

    get_entity: tool({
      description: 'Get a single entity by ID.',
      parameters: z.object({
        entity: z.string().describe('Entity/module name'),
        id: z.string().describe('Entity ID'),
      }),
      execute: async ({ entity, id }) => {
        let service: Record<string, unknown> | null = null
        try {
          service = app.resolve<Record<string, unknown>>(`${entity}ModuleService`)
        } catch {
          try {
            service = (app.modules as Record<string, Record<string, unknown> | undefined>)[entity] ?? null
          } catch {
            /* not found */
          }
        }
        if (!service || typeof service.findById !== 'function') {
          return { error: `Entity "${entity}" does not support findById` }
        }
        const item = await (service.findById as (id: string) => Promise<unknown>)(id)
        if (!item) return { error: `${entity} "${id}" not found` }
        return item
      },
    }),

    list_entities: tool({
      description: 'List all available entity types with their current count.',
      parameters: z.object({}),
      execute: async () => {
        const results: Record<string, number> = {}
        for (const name of moduleNames) {
          const service = (app.modules as Record<string, Record<string, unknown> | undefined>)[name]
          if (service && typeof service.list === 'function') {
            try {
              const items = await service.list()
              results[name] = Array.isArray(items) ? items.length : 0
            } catch {
              results[name] = -1
            }
          }
        }
        return results
      },
    }),

    describe_entity: tool({
      description:
        'Get the full schema of an entity: field names, types, enum values, cross-module links, and available commands (mutations). Call this BEFORE querying to know what fields, relations, and filters are available. Links tell you which related entities you can include via dotted field paths in query_entity.',
      parameters: z.object({
        entity: z.string().describe(`Entity name (camelCase). Available: ${moduleNames.join(', ')}`),
      }),
      execute: async ({ entity }) => {
        let service: Record<string, unknown> | null = null
        try {
          service = app.resolve<Record<string, unknown>>(`${entity}Service`)
        } catch {
          try {
            service = app.resolve<Record<string, unknown>>(`${entity}ModuleService`)
          } catch {
            try {
              service = (app.modules as Record<string, Record<string, unknown> | undefined>)[entity] ?? null
            } catch {
              /* not found */
            }
          }
        }

        // External entities (defineModel(...).external()) have no service — they live only
        // in the entity registry and are resolved via extendQueryGraph resolvers. Fall back
        // to the registry here so the AI can still discover their schema for query_entity.
        if (!service) {
          try {
            const entityRegistry =
              app.resolve<Map<string, { name: string; schema: Record<string, unknown> }>>('__entityRegistry')
            const canonical = [...entityRegistry.keys()].find((k) => k.toLowerCase() === entity.toLowerCase())
            const dml = canonical ? entityRegistry.get(canonical) : undefined
            if (dml?.schema) {
              return extractEntitySchema(dml, [], [])
            }
          } catch {
            /* entity registry not available */
          }
          return { error: `Entity "${entity}" not found. Available: ${moduleNames.join(', ')}` }
        }

        // Resolve cross-module links for this entity
        const entityLinks: LinkSchema[] = []
        try {
          const { getRegisteredLinks } = await import('@manta/core')
          for (const link of getRegisteredLinks()) {
            if (link.leftModule === entity || link.leftEntity.toLowerCase() === entity) {
              entityLinks.push({
                linkedEntity: link.rightEntity,
                linkedModule: link.rightModule,
                description: `Use "${link.rightModule}.fieldName" in fields to include ${link.rightEntity} data`,
              })
            }
            if (link.rightModule === entity || link.rightEntity.toLowerCase() === entity) {
              entityLinks.push({
                linkedEntity: link.leftEntity,
                linkedModule: link.leftModule,
                description: `Use "${link.leftModule}.fieldName" in fields to include ${link.leftEntity} data`,
              })
            }
          }
        } catch {
          /* no links */
        }

        // Extract DML schema from __entity (service.define) or $modelObjects (createService)
        const dmlEntity = service.__entity as { name: string; schema: Record<string, unknown> } | undefined
        if (dmlEntity?.schema) {
          const compensableMethods = (service.__compensableMethods as string[] | undefined) ?? []
          return extractEntitySchema(dmlEntity, compensableMethods, entityLinks)
        }

        // Fallback for createService-based services — sample first item to infer fields
        if (typeof service.list === 'function') {
          try {
            const items = (await (service.list as () => Promise<unknown[]>)()) as Record<string, unknown>[]
            if (items.length > 0) {
              const sample = items[0]
              const fields = Object.keys(sample).map((k) => ({
                name: k,
                type: typeof sample[k] === 'number' ? 'number' : typeof sample[k] === 'boolean' ? 'boolean' : 'text',
              }))
              return { name: entity, fields, relations: [], links: entityLinks, commands: [] }
            }
          } catch {
            /* empty */
          }
        }

        return { name: entity, fields: [], relations: [], links: entityLinks, commands: [] }
      },
    }),

    // ── Dashboard tools ──────────────────────────────────────────

    render_component: tool({
      description: `Render a visual component in the chat.

DataTable — for lists (max 5 rows per page, with search and pagination):
  component: { type: "DataTable", props: { columns: [{ key: "name", label: "Name" }, { key: "count", label: "Count" }] } }
  data: { items: [...], count: N }
  Arrays in data are auto-displayed as counts.

InfoCard — for single entity details:
  component: { type: "InfoCard", props: { title: "Customer", fields: [{ key: "email", label: "Email" }] } }
  data: { email: "john@example.com", ... }

StatsCard — for metrics:
  component: { type: "StatsCard", props: { title: "Overview", metrics: [{ label: "Total", key: "total" }] } }
  data: { total: 42 }`,
      parameters: z.object({
        component: z.object({
          type: z.enum(['DataTable', 'InfoCard', 'StatsCard']),
          props: z.record(z.string(), z.unknown()),
        }),
        data: z.record(z.string(), z.unknown()).optional(),
        title: z.string().optional(),
      }),
      execute: async ({ component, data, title }) => {
        return { __renderComponent: true, component, data: data || {}, title }
      },
    }),

    modify_component: tool({
      description: 'Override a data component on the current page. Provide the COMPLETE replacement.',
      parameters: z.object({
        componentId: z.string(),
        component: z.object({
          type: z.string(),
          props: z.record(z.string(), z.unknown()),
        }),
        reason: z.string(),
      }),
      execute: async ({ componentId, component, reason }) => {
        return {
          __modifyComponent: true,
          componentId,
          component: { id: componentId, type: component.type, props: component.props },
          reason,
        }
      },
    }),

    modify_page: tool({
      description: 'Override the composition of the current page (component order, layout).',
      parameters: z.object({
        pageId: z.string(),
        page: z.object({
          layout: z.enum(['single-column', 'two-column']).optional(),
          main: z.array(z.string()).optional(),
          sidebar: z.array(z.string()).optional(),
        }),
        reason: z.string(),
      }),
      execute: async ({ pageId, page, reason }) => {
        return { __modifyPage: true, pageId, page, reason }
      },
    }),

    create_page: tool({
      description: `Create a custom page. Uses the same structure as definePage().

Example — list page:
{
  pageId: "custom/customer-group-analysis",
  title: "Analyse Customer Groups",
  icon: "BarChart3",
  spec: {
    header: { title: "Analyse Customer Groups" },
    main: [
      {
        type: "DataTable",
        query: { graph: { entity: "customerGroup", fields: ["name", "customers", "created_at"], pagination: { limit: 20 } } },
        columns: [
          { key: "name", label: "Nom", format: "highlight" },
          { key: "customers", label: "Customers", type: "count" },
          { key: "created_at", label: "Créé", format: "date" }
        ],
        searchable: true
      }
    ]
  }
}

To include relation counts, add the relation name to fields (e.g. "customers" for M:N).
Arrays are displayed as counts in columns with type: "count".

StatsCard blocks are supported when backed by a HogQL query that returns a single row with named columns (each column becomes a metric). Example:
{
  type: "StatsCard",
  query: { hogql: { query: "SELECT COUNT(*) AS total, COUNT(DISTINCT distinct_id) AS unique_users FROM events WHERE toDate(timestamp) = today() LIMIT 1" } },
  metrics: [
    { label: "Total events today", key: "total" },
    { label: "Unique users today", key: "unique_users" }
  ]
}

IMPORTANT: Don't create routes that start with the same path as existing pages (e.g. don't use /customer-groups if that route exists).`,
      parameters: z.object({
        pageId: z.string().describe('Must start with "custom/"'),
        title: z.string(),
        icon: z.string().optional(),
        spec: z.object({
          header: z
            .object({
              title: z.string(),
              actions: z.array(z.string()).optional(),
            })
            .optional(),
          main: z.array(z.record(z.string(), z.unknown())),
          sidebar: z.array(z.record(z.string(), z.unknown())).optional(),
        }),
      }),
      execute: async ({ pageId, title, icon, spec }) => {
        const slug = pageId.replace(/^custom\//, '')
        const route = `/${slug}`

        // Map AI type names to renderer type names
        const mapType = (t: string) => {
          const map: Record<string, string> = { DataTable: 'EntityTable', datatable: 'EntityTable' }
          return map[t] ?? t
        }

        // Extract and normalize the query for BLOCK-level consumption (passed to useBlockQuery).
        // Graph queries are unwrapped to the flat shape expected by the legacy EntityTable block;
        // named + hogql queries are passed through as-is because useBlockQuery inspects them
        // structurally via isGraphQuery / isNamedQuery / isHogQLQuery type guards.
        const normalizeQuery = (block: Record<string, unknown>) => {
          const rawQuery = block.query as Record<string, unknown> | undefined
          if (!rawQuery) return undefined
          // { graph: { entity, fields, ... } } → { entity, fields, list: true, pageSize? }
          if (rawQuery.graph && typeof rawQuery.graph === 'object') {
            const graph = rawQuery.graph as Record<string, unknown>
            return {
              entity: graph.entity,
              fields: graph.fields,
              list: true,
              ...(graph.pagination ? { pageSize: (graph.pagination as Record<string, unknown>).limit } : {}),
            }
          }
          // { name, input } or { hogql: { query } } — keep the original shape so useBlockQuery's
          // type guards can route to the right fetcher.
          return rawQuery
        }

        // Auto-create PageHeader component from spec.header
        const headerComponent = spec.header
          ? {
              id: `${pageId}-header`,
              type: 'PageHeader',
              props: { title: spec.header.title, actions: spec.header.actions },
            }
          : null

        const components = spec.main.map((block, i) => {
          const b = block as Record<string, unknown>
          return {
            id: `${pageId}-main-${i}`,
            type: mapType(b.type as string),
            props: { ...b, type: mapType(b.type as string), query: normalizeQuery(b) ?? b.query },
          }
        })

        // Prepend header to components list
        if (headerComponent) components.unshift(headerComponent)
        const sidebarComponents =
          spec.sidebar?.map((block, i) => {
            const b = block as Record<string, unknown>
            return {
              id: `${pageId}-sidebar-${i}`,
              type: mapType(b.type as string),
              props: { ...b, type: mapType(b.type as string) },
            }
          }) ?? []

        // Page-level query (PageSpec.query) — required by PageSpecSchema with a non-optional `entity`.
        // PageRenderer fires a top-level fetch based on this even though blocks have their own
        // queries. For pages whose blocks are entirely hogql or named (no local entity), we'd
        // have no entity to use — Zod would reject the spec. Strategy: find the FIRST graph block
        // in main[] and use its entity; if none exists, fall back to a placeholder that won't
        // 500 (we use 'admin' which always exists when defineUserModel('admin') is declared, and
        // pageSize: 1 to minimize the wasted fetch).
        const firstGraphBlock = (spec.main as Array<Record<string, unknown>>).find((b) => {
          const q = b.query as Record<string, unknown> | undefined
          return q && typeof q.graph === 'object' && q.graph !== null
        })
        const firstGraphQuery = firstGraphBlock
          ? (normalizeQuery(firstGraphBlock) as Record<string, unknown> | undefined)
          : undefined
        const pageQuery = firstGraphQuery?.entity
          ? {
              entity: firstGraphQuery.entity as string,
              list: true,
              // fields is a single string in PageSpec (comma-separated), not an array
              ...(firstGraphQuery.fields
                ? {
                    fields: Array.isArray(firstGraphQuery.fields)
                      ? (firstGraphQuery.fields as string[]).join(',')
                      : firstGraphQuery.fields,
                  }
                : {}),
              ...(firstGraphQuery.pageSize ? { pageSize: firstGraphQuery.pageSize as number } : {}),
            }
          : // No graph block in the page — tiny placeholder fetch that satisfies Zod and renders a no-op.
            // 'admin' is the user table auto-created by defineUserModel('admin') and always exists.
            { entity: 'admin', list: true, pageSize: 1 }

        const page = {
          id: pageId,
          type: 'list' as const,
          layout: spec.sidebar ? ('two-column' as const) : ('single-column' as const),
          route,
          query: pageQuery,
          main: components.map((c) => c.id),
          ...(sidebarComponents.length ? { sidebar: sidebarComponents.map((c) => c.id) } : {}),
        }
        const navItem = { key: pageId, label: title, path: route, icon: icon || 'SquaresPlus' }
        return { __createPage: true, page, components: [...components, ...sidebarComponents], navItem }
      },
    }),

    update_custom_page: tool({
      description: 'Update route or label of an existing custom page.',
      parameters: z.object({
        pageId: z.string(),
        route: z.string().optional(),
        label: z.string().optional(),
        reason: z.string(),
      }),
      execute: async ({ pageId, route, label, reason }) => {
        if (!pageId.startsWith('custom/')) return { error: `Only custom pages can be updated` }
        const updates: { route?: string; label?: string } = {}
        if (route) updates.route = route
        if (label) updates.label = label
        return { __updateCustomPage: true, pageId, updates, reason }
      },
    }),

    delete_page: tool({
      description: 'Delete a custom page (pageId must start with "custom/").',
      parameters: z.object({ pageId: z.string() }),
      execute: async ({ pageId }) => {
        if (!pageId.startsWith('custom/')) return { error: `Only custom pages can be deleted` }
        return { __deletePage: true, pageId }
      },
    }),

    reset_component: tool({
      description: 'Reset a component override back to default.',
      parameters: z.object({ componentId: z.string() }),
      execute: async ({ componentId }) => ({ __resetComponent: true, componentId }),
    }),

    get_navigation: tool({
      description:
        'Get the REAL current navigation menu as displayed in the sidebar. Includes all default items and any overrides.',
      parameters: z.object({}),
      execute: async () => {
        // Return the real navigation: override if set, otherwise the default from the code
        const navigation = navigationOverride || defaultNavigation || []
        return { __getNavigation: true, navigation, isOverridden: !!navigationOverride }
      },
    }),

    set_navigation: tool({
      description:
        'Replace the entire navigation menu. ALWAYS call get_navigation first to get the real current menu. Never invent routes — only use routes from get_navigation or from pages you created.',
      parameters: z.object({
        navigation: z.array(
          z.object({
            key: z.string(),
            label: z.string(),
            icon: z.string(),
            path: z.string(),
            children: z
              .array(z.object({ key: z.string(), label: z.string(), path: z.string(), icon: z.string().optional() }))
              .optional(),
          }),
        ),
        reason: z.string(),
      }),
      execute: async ({ navigation, reason }) => ({ __setNavigation: true, navigation, reason }),
    }),

    reset_navigation: tool({
      description: 'Reset navigation to default.',
      parameters: z.object({}),
      execute: async () => ({ __resetNavigation: true }),
    }),

    // ── PostHog analytics tool (conditional on POSTHOG_API_KEY) ──
    //
    // Exposed only when a PostHog personal API key is set. Lets the AI write raw HogQL
    // queries against the PostHog data warehouse (events, persons, session_replay_events,
    // data warehouse tables like klaviyo_*, shopify_*, stripe_*).
    //
    // Why a dedicated tool instead of query_entity:
    //   query_entity returns rows. For analytics questions ("how many unique visitors
    //   today?", "top 10 events by count this week") the AI would otherwise pull thousands
    //   of raw rows into its context window and crash on "prompt too long" (Claude maxes
    //   at 200k tokens, one posthog event row ≈ 2k tokens of JSON properties). HogQL's
    //   COUNT / GROUP BY / DATE functions return tiny aggregated result sets instead.
    //
    // Safety: SELECT-only. Any query not starting with SELECT (INSERT, UPDATE, DELETE,
    // DROP, TRUNCATE, ALTER, CREATE) is refused client-side before it hits the API.
    ...(process.env.POSTHOG_API_KEY
      ? {
          query_posthog_hogql: tool({
            description: `Run a raw HogQL SELECT query against the PostHog data warehouse. USE THIS for any analytics question that requires aggregation, counting, grouping, date filtering, or joining across PostHog tables — NEVER use query_entity for analytics because it returns individual rows and will overflow the context window.

Available tables (ClickHouse):
  events              — every PostHog event (fields: uuid, event, distinct_id, timestamp, properties, person_id, ...)
  persons             — identified persons (fields: id, distinct_id, created_at, properties)
  session_replay_events — session recordings (fields: session_id, distinct_id, timestamp, click_count, ...)
  groups              — group analytics rows
  (plus any data warehouse table synced in this PostHog project — klaviyo_campaign, shopify_order, stripe_charge, etc.)

HogQL tips (differs from standard SQL):
  - Date helpers: today(), now(), toDate(col), toStartOfDay(col), dateDiff('day', a, b)
  - JSON property access: properties.$current_url (dotted, no quotes)
  - Always LIMIT results (even aggregations — add LIMIT 1000 as a safety cap)
  - COUNT(DISTINCT col) for unique counts

Examples:
  • Unique visitors today:
    SELECT COUNT(DISTINCT distinct_id) AS unique_visitors FROM events WHERE toDate(timestamp) = today()
  • Top 10 events by volume this week:
    SELECT event, COUNT(*) AS total FROM events WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY event ORDER BY total DESC LIMIT 10
  • Sessions today:
    SELECT COUNT(DISTINCT properties.$session_id) FROM events WHERE toDate(timestamp) = today()
  • Klaviyo campaigns from warehouse:
    SELECT name, send_time FROM klaviyo_campaign ORDER BY send_time DESC LIMIT 20`,
            parameters: z.object({
              query: z
                .string()
                .describe('A HogQL SELECT query. Must start with SELECT. Always include a LIMIT clause.'),
            }),
            execute: async ({ query }: { query: string }) => {
              const trimmed = query.trim()
              // Allow both bare SELECT and CTE queries starting with WITH (which eventually
              // SELECT anyway). Refuse anything else (INSERT, UPDATE, DELETE, DROP, ALTER, …).
              if (!/^(with|select)\b/i.test(trimmed)) {
                return { error: 'Only SELECT or WITH…SELECT queries are allowed. This tool is read-only.' }
              }
              const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
              const key = process.env.POSTHOG_API_KEY
              try {
                const res = await fetch(`${host}/api/projects/@current/query/`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ query: { kind: 'HogQLQuery', query: trimmed } }),
                })
                if (!res.ok) {
                  const body = await res.text()
                  return {
                    error: `PostHog HogQL ${res.status}: ${body}`,
                    hint: 'Check HogQL syntax. Common mistakes: missing LIMIT, using SQL functions not in HogQL, referencing non-existent columns. Use describe_entity or retry with a simpler query.',
                  }
                }
                const data = (await res.json()) as { results?: unknown[][]; columns?: string[]; types?: string[] }
                if (!data.results || !data.columns) {
                  return { columns: [], rows: [], note: 'Query returned no results structure.' }
                }
                // Cap result rows at 200 to keep context manageable even if LIMIT is missing
                const rows = data.results.slice(0, 200).map((row) => {
                  const obj: Record<string, unknown> = {}
                  data.columns?.forEach((col, idx) => {
                    obj[col] = row[idx]
                  })
                  return obj
                })
                return {
                  columns: data.columns,
                  rows,
                  rowCount: data.results.length,
                  truncated: data.results.length > 200,
                }
              } catch (err) {
                return { error: (err as Error).message }
              }
            },
          }),
        }
      : {}),

    // ── CQRS command tools (auto-discovered) ─────────────────────
    ...commandTools,

    // ── CQRS query tools (auto-discovered) ───────────────────────
    ...queryTools,
  }
}

// ── System prompt ────────────────────────────────────────────────

function buildSystemPrompt(
  moduleNames: string[],
  commandNames: string[],
  linkGraph: LinkGraphEntry[] = [],
  queries: Array<{ name: string; description: string }> = [],
) {
  // Build relation descriptions: for each entity, list what relations are available
  const relationsByEntity = new Map<string, string[]>()
  for (const l of linkGraph) {
    const isMany = l.cardinality === 'M:N'
    const leftRel = isMany ? `${l.right}s` : l.right
    const rightRel = isMany ? `${l.left}s` : l.left
    const leftDescs = relationsByEntity.get(l.left) ?? []
    leftDescs.push(`${leftRel} (${l.cardinality})`)
    relationsByEntity.set(l.left, leftDescs)
    const rightDescs = relationsByEntity.get(l.right) ?? []
    rightDescs.push(`${rightRel} (${l.cardinality})`)
    relationsByEntity.set(l.right, rightDescs)
  }

  return `You are an AI assistant for a Manta admin dashboard.

## Available entities (camelCase — use these EXACT names)

${moduleNames
  .map((n) => {
    const rels = relationsByEntity.get(n)
    return rels ? `- ${n} — relations: ${rels.join(', ')}` : `- ${n}`
  })
  .join('\n')}

## Available commands (writes — mutations)

${commandNames.map((n) => `- command_${n}: Execute the "${n}" command`).join('\n')}

${
  queries.length > 0
    ? `## Available queries (reads — no side effects)

${queries.map((q) => `- query_${q.name.replace(/[-:]/g, '_')}: ${q.description}`).join('\n')}
`
    : ''
}
## Tool selection rules — IMPORTANT

- **Reads** (listing, fetching, analytics) → use \`query_*\` tools OR \`query_entity\` for generic entity queries.
- **Writes** (create / update / delete / side-effecting actions) → use \`command_*\` tools.
- **Visualizations** → use \`render_component\`.
- When both a specialized \`query_*\` tool and \`query_entity\` can answer the question, prefer the specialized one because it knows the right backend (e.g. external analytics, search index).

## CRITICAL — Analytics / event-based questions: NEVER guess event names

When the user asks any question involving **analytics, funnels, conversion, counting, acheteurs,
achats, visiteurs, sessions, orders, purchases, commandes, signups, clicks, impressions**, you are
absolutely forbidden from guessing event names based on natural-language intent. Every project
names its events differently — "order_completed", "checkout_completed", "Order Placed",
"purchase", "shopify_order_created" are all possible, and YOU DO NOT KNOW which one this project
uses until you verify.

**Mandatory workflow before writing any analytics query:**

1. **Discover the real event landscape first.** Run:
   \`\`\`sql
   SELECT event, COUNT(*) AS n
   FROM events
   WHERE toDate(timestamp) = today()
   GROUP BY event
   ORDER BY n DESC
   LIMIT 50
   \`\`\`
   (Widen the date range if today's data is sparse.)

2. **Pick the exact event name** from what the discovery returned. If nothing in the list
   obviously matches the user's concept, **STOP** and ask the user: "Here are the events tracked
   in your project: [list]. Which one corresponds to 'acheté' / 'purchase' / 'signup' in your
   tracking?" — do NOT proceed with a guess.

3. **Use the exact event name verbatim** in your query and in your written synthesis. If you
   queried \`event = 'checkout_started'\`, you MUST write "checkout_started" or "démarré le
   checkout" in the answer, NEVER "ont acheté", "ont commandé", or any other paraphrase that
   changes the semantic meaning. Starting a checkout is NOT buying.

4. **Never silently fall back** to \`LIKE '%checkout%'\`, \`event IN (list_of_guesses)\`, or
   partial matches when an exact name returns 0. A zero result means "this concept is tracked
   under a different name" — go back to step 1 or ask the user.

5. **Label mapping table in your synthesis**: when presenting any analytics result, include a
   small "Data source" line that makes the event → metric mapping explicit. Example:
   > Data source: \`event = 'checkout_completed'\` over today, COUNT(DISTINCT distinct_id).

**Why this matters:** confusing \`checkout_started\` with "ont acheté" produces a 6x overstatement
of conversion. Confusing \`product_added_to_cart\` with "achats" produces 17x overstatement.
Every analytics hallucination in this system has historically come from semantic guessing between
French/English natural language and raw event names. Treat event names as foreign words you
cannot translate — only transliterate.

## HogQL syntax cheatsheet — IMPORTANT

HogQL is a **ClickHouse dialect**, NOT PostgreSQL or MySQL. Using the wrong syntax is the #1 cause
of retry loops. Memorize these:

**JSON access — use ClickHouse functions, NOT \`->>\`, \`->\`, or \`JSON_EXTRACT_*\`:**
\`\`\`sql
-- ❌ WRONG (PostgreSQL / MySQL syntax):
col->>'$.key'
col->'$.key'
JSON_EXTRACT_STRING(col, '$.key')
JSON_EXTRACT(col, '$.key')

-- ✅ CORRECT (HogQL / ClickHouse):
JSONExtractString(col, 'key')              -- single-level
JSONExtractString(col, 'parent', 'child')  -- nested via variadic args
JSONExtractInt(col, 'count')               -- typed extractors
JSONExtractFloat(col, 'price')
JSONExtractBool(col, 'active')
JSONExtractRaw(col, 'obj')                  -- returns raw JSON sub-object
properties.foo                              -- shorthand for direct property access (events.properties only)
\`\`\`

**COUNT(*) with multiple tables (JOINs):**
\`\`\`sql
-- ❌ WRONG: "Cannot use '*' without table name when there are multiple tables"
SELECT COUNT(*) FROM events e JOIN persons p ON ...

-- ✅ CORRECT: alias a column or use COUNT(1)
SELECT COUNT(e.id) FROM events e JOIN persons p ON ...
SELECT COUNT(1) FROM events e JOIN persons p ON ...
\`\`\`

**CASE / CONDITIONAL:**
\`\`\`sql
-- HogQL accepts standard SQL CASE WHEN, BUT every WHEN must have a matching THEN
-- and you MUST include ELSE to be safe (HogQL lowers CASE to multiIf which requires
-- odd arg count).

-- ✅ CORRECT:
CASE WHEN x > 0 THEN 'positive' ELSE 'non-positive' END

-- ❌ WRONG (no ELSE):
CASE WHEN x > 0 THEN 'positive' END
\`\`\`

**Date / time functions:**
\`\`\`sql
today()                              -- returns date of today in project timezone
now()                                -- current timestamp
toDate(timestamp_col)                -- extract date from timestamp
toStartOfDay(col), toStartOfHour(col), toStartOfMonth(col)
dateDiff('day', a, b)                -- integer diff between two dates
timestamp_col > now() - INTERVAL 7 DAY  -- relative filter
\`\`\`

**String matching:**
\`\`\`sql
col ILIKE '%foo%'    -- case-insensitive LIKE — supported
col LIKE '%foo%'     -- case-sensitive
match(col, 'regex')  -- regex match (ClickHouse-native)
\`\`\`

**Aggregations with filters — use \`countIf\` / \`sumIf\` instead of CASE WHEN:**
\`\`\`sql
-- ✅ Idiomatic HogQL / ClickHouse:
SELECT
  countIf(event = 'checkout_completed') AS purchases,
  countIf(event = 'page_viewed') AS page_views,
  sumIf(revenue, event = 'order_placed') AS total_revenue
FROM events
WHERE toDate(timestamp) = today()
\`\`\`

**Always include a LIMIT** even on aggregation queries (safety net, defaults to 200 on truncation).

If a query returns a validation error, **read the error message carefully** — it tells you which
function or syntax isn't supported — then rewrite using the HogQL equivalent above. Do NOT retry
the exact same query.

## Property names follow the same rule

Same contract for properties: never assume \`$order_id\`, \`$revenue\`, \`total\`, \`value\` exist
without verifying. To inspect the shape of an event's properties, sample one row first:
\`\`\`sql
SELECT properties FROM events WHERE event = 'checkout_completed' LIMIT 1
\`\`\`
Then use only properties you actually saw in the sample.

## PostHog Data Warehouse tables (Klaviyo, Shopify, Stripe, HubSpot, …)

When the user asks about **email marketing, campaigns, CRM, subscribers, lists, flows, metrics,
Shopify orders, Stripe charges, or any non-event business data**, the answer often lives in
PostHog's Data Warehouse (synced external sources), NOT in the \`events\` or \`persons\` tables.

**Warehouse tables use SCHEMA.TABLE dotted notation**, not underscore-prefixed names. Query them
with the same \`query_posthog_hogql\` tool. Examples of real tables that exist in a Klaviyo-synced
project:

\`\`\`
klaviyo.profiles          -- contacts (id, email, first_name, last_name, phone_number, location, …)
klaviyo.events            -- per-profile activity (opened email, clicked, placed order, …)
klaviyo.email_campaigns   -- campaigns (id, name, send_time, subject, …)
klaviyo.sms_campaigns
klaviyo.flows             -- automation flows
klaviyo.lists             -- subscriber lists
klaviyo.metrics           -- custom metrics defined in Klaviyo
\`\`\`

Shopify / Stripe / HubSpot / other sources follow the same pattern when synced: \`shopify.orders\`,
\`shopify.customers\`, \`stripe.charges\`, \`hubspot.contacts\`, etc.

**Discovery workflow for warehouse queries:**

1. **Don't guess the schema/table name.** Users may or may not have synced a given source. Before
   writing a business query, probe with a tiny query that also serves as existence check:
   \`\`\`sql
   SELECT COUNT(*) FROM klaviyo.profiles
   \`\`\`
   If this returns \`Unknown table\`, the source isn't synced — tell the user rather than inventing.

2. **Discover column names with a sample.** Each warehouse source has its own shape, and you
   don't know column names a priori:
   \`\`\`sql
   SELECT * FROM klaviyo.email_campaigns LIMIT 1
   \`\`\`
   The tool returns both \`columns\` and \`rows\` — read the columns list before writing your real
   query. Columns from Klaviyo differ from Shopify differ from Stripe.

3. **Cross-source joins are possible.** HogQL can join a warehouse table with \`events\` or
   \`persons\` in a single query (e.g. correlate Klaviyo email clicks with PostHog checkout events).
   Use \`JOIN\` with explicit ON clauses, matching on email or distinct_id.

4. **Apply the same event-name rule to warehouse tables.** Klaviyo's events table has an \`event\`-
   equivalent column (often named \`metric_id\` → join to \`klaviyo.metrics.name\`). Never guess a
   metric name like "Placed Order" or "Opened Email" — list distinct values first.

## How to query data — query_entity tool

Use query_entity to read data. Entity names are camelCase (e.g. "customerGroup", NOT "customer_group").

### Including related entities

To include relations, add the relation name to fields:

  query_entity({ entity: "customerGroup", fields: ["name", "customers"] })
  → Returns: { data: [{ name: "VIP", customers: [{...}, {...}], ... }] }

The relation name is the LINKED entity name:
${linkGraph
  .map((l) => {
    const isMany = l.cardinality === 'M:N'
    return `  - On ${l.left}: use "${isMany ? `${l.right}s` : l.right}" to get linked ${l.right} entities
  - On ${l.right}: use "${isMany ? `${l.left}s` : l.left}" to get linked ${l.left} entities`
  })
  .join('\n')}

To count related entities, just count the array length in the response.

### Filters

Simple key-value pairs only:
- Exact match: { "status": "active" }
- Multiple values: { "status": ["active", "archived"] }
- No operators ($ne, $gt etc.)

## CRITICAL — Always include relations when analyzing relationships

When the user asks about relationships between entities (e.g. "how many customers per group"):
- You MUST include the relation name in fields: query_entity({ entity: "customerGroup", fields: ["name", "customers"] })
- WITHOUT the relation in fields, the response will NOT include related entities
- Relations are returned as arrays. Count the length for counts.

## Rendering data — IMPORTANT

When rendering data in chat, use render_component with type "DataTable".
Arrays in data items are automatically displayed as counts.

## Tool workflow

1. **query_entity** — include relation names in fields when you need related data.
2. **render_component** — use DataTable for lists, InfoCard for details, StatsCard for metrics.
3. **command_*** — for mutations.

## Creating pages

Use create_page with the same structure as definePage(). The spec must include:
- header: { title: "Page Title" }
- main: array of blocks (DataTable, InfoCard, StatsCard)

Each block has a \`query\` prop that supports **three shapes** depending on the data source:

### Shape 1 — Graph query (local entities, default)
For blocks backed by a local Manta entity (customer, product, etc.):
\`\`\`json
{
  "type": "DataTable",
  "query": { "graph": { "entity": "customerGroup", "fields": ["name", "customers"], "pagination": { "limit": 20 } } },
  "columns": [{ "key": "name", "label": "Name" }, { "key": "customers", "label": "Customers", "type": "count" }],
  "searchable": true
}
\`\`\`
To include relation data, add the relation name to fields. Use \`type: "count"\` on columns with array values.

### Shape 2 — Named query (custom handler already defined)
For blocks backed by a \`defineQuery()\` TS handler on the backend (mix of sources, custom logic):
\`\`\`json
{
  "type": "DataTable",
  "query": { "name": "active-customers", "input": { "days": 7 } },
  "columns": [{ "key": "email", "label": "Email" }, { "key": "event_count", "label": "Events" }]
}
\`\`\`

### Shape 3 — HogQL query (PostHog Data Warehouse, direct)
For blocks backed by **raw HogQL against the PostHog warehouse** (klaviyo.*, shopify.*, stripe.*, events, persons, etc.).
Use this when the user asks for **pure analytics** that don't need to join local entities —
top campaigns, active visitors, event breakdowns, top products by warehouse data, etc.
\`\`\`json
{
  "type": "DataTable",
  "query": {
    "hogql": {
      "query": "SELECT name, status, send_time FROM klaviyo.email_campaigns WHERE status = 'Sent' ORDER BY send_time DESC LIMIT 20"
    }
  },
  "columns": [
    { "key": "name", "label": "Campaign" },
    { "key": "status", "label": "Status" },
    { "key": "send_time", "label": "Sent at", "format": "datetime" }
  ]
}
\`\`\`

StatsCard with a HogQL query that returns a single row:
\`\`\`json
{
  "type": "StatsCard",
  "query": {
    "hogql": {
      "query": "SELECT COUNT(DISTINCT distinct_id) AS unique_visitors, COUNT(*) AS total_events FROM events WHERE toDate(timestamp) = today()"
    }
  },
  "metrics": [
    { "label": "Unique visitors today", "key": "unique_visitors" },
    { "label": "Total events", "key": "total_events" }
  ]
}
\`\`\`

**Rules for the \`hogql\` shape:**
- The query runs via a server-side relay at POST /api/admin/posthog/hogql — SELECT/WITH only, admin auth required.
- Results are capped at 500 rows. Always include an explicit LIMIT in your query for predictability.
- Columns in your HogQL \`SELECT\` become the keys that \`columns\` / \`metrics\` reference.
- A HogQL query with **a single row** is auto-interpreted as a StatsCard data object; with multiple rows it becomes items for a DataTable.
- Same HogQL cheatsheet applies (JSONExtractString, countIf, toDate/today, no JSON_EXTRACT, no \`->>\`).
- \`:param\` placeholders in the HogQL string are substituted from route params (e.g. on \`/customers/:id\` the string \`:id\` is replaced with the current customer id).
- **Never mix local + HogQL in a single block**. For mixed views, ask the user to create a \`defineQuery()\` handler (or propose the TS code), then use shape 2 referencing that name. Hybrid in-block composition is not supported.

## Navigation

- get_navigation → read current menu override (may be empty if not overridden yet)
- set_navigation → replace the entire menu
- reset_navigation → restore defaults

### CRITICAL rules for set_navigation:
1. ALWAYS call get_navigation first
2. If get_navigation returns empty (isOverridden: false), use the DEFAULT navigation below
3. NEVER invent routes. Only use routes from the default nav or from pages YOU created with create_page
4. Keep all existing items when adding/nesting — don't drop anything

### Default navigation (when get_navigation returns empty):
- { key: "products", label: "Products", icon: "SquaresPlus", path: "/products" }
- { key: "settings", label: "Settings", icon: "CogSixTooth", path: "/settings" }

Custom pages you created appear in a separate "Custom" section automatically. To nest a custom page under an existing item, use set_navigation with the full menu including children.

## Guidelines

- Be concise. Use visual components for data display.
- Always fetch real data before displaying it.
- When modifying components, include ALL existing props plus changes.`
}

// ── Handler ──────────────────────────────────────────────────────

interface LinkGraphEntry {
  left: string
  right: string
  pivot: string
  cardinality: string
}

export function createAiChatHandler(app: MantaApp, moduleNames: string[], linkGraph: LinkGraphEntry[] = []) {
  return async (req: Request): Promise<Response> => {
    try {
      const body = await getRequestBody<{
        messages: Array<{ role: 'user' | 'assistant'; content: string }>
        pageContext?: {
          pageId: string
          route: string
          composition: { main: string[]; sidebar?: string[] }
          components: Record<string, { id: string; type: string; props: Record<string, unknown> }>
        }
        customPages?: Array<{ pageId: string; label: string; path: string }>
        navigationOverride?: unknown[]
        defaultNavigation?: unknown[]
      }>(req)

      if (!body.messages || !Array.isArray(body.messages)) {
        return Response.json({ error: 'messages array is required' }, { status: 400 })
      }

      let commandNames: string[] = []
      try {
        const registry = app.resolve<CommandRegistry>('commandRegistry')
        commandNames = registry.list().map((e) => e.name)
      } catch {
        /* no registry */
      }
      // Include auto-generated entity commands
      try {
        const entityCmds = app.resolve<Map<string, { name: string }>>('__entityCommandRegistry')
        for (const [name] of entityCmds) {
          if (!commandNames.includes(name)) commandNames.push(name)
        }
      } catch {
        /* no entity command registry */
      }

      // Collect queries from registry (defineQuery files — CQRS reads)
      let queryEntries: Array<{ name: string; description: string }> = []
      try {
        const queryRegistry = app.resolve<QueryRegistry>('queryRegistry')
        queryEntries = queryRegistry.list().map((e) => ({ name: e.name, description: e.description }))
      } catch {
        /* no query registry */
      }

      // Build system prompt with page context
      let systemPrompt = buildSystemPrompt(moduleNames, commandNames, linkGraph, queryEntries)

      // Auto-inject the warehouse table index (Klaviyo / Shopify / Stripe / …) with full
      // column schemas if POSTHOG_API_KEY is set and has warehouse_table:read scope. Cached
      // 5 min server-side to avoid hitting the REST API on every chat request.
      const warehouseIndex = await getWarehouseIndexSection()
      if (warehouseIndex) {
        systemPrompt += `\n\n${warehouseIndex}`
      }

      if (body.pageContext) {
        systemPrompt += `\n\n## Current page context\n\n`
        systemPrompt += `Page ID: ${body.pageContext.pageId}\nRoute: ${body.pageContext.route}\n`
        systemPrompt += `Main: ${JSON.stringify(body.pageContext.composition.main)}\n`
        if (body.pageContext.composition.sidebar) {
          systemPrompt += `Sidebar: ${JSON.stringify(body.pageContext.composition.sidebar)}\n`
        }
        systemPrompt += `\nComponents:\n`
        for (const [id, comp] of Object.entries(body.pageContext.components)) {
          systemPrompt += `\n### ${id}\n\`\`\`json\n${JSON.stringify(comp, null, 2)}\n\`\`\`\n`
        }
      }
      if (body.customPages?.length) {
        systemPrompt += `\n\n## Existing custom pages\n\n`
        for (const cp of body.customPages) {
          systemPrompt += `- **${cp.label}** — pageId: \`${cp.pageId}\`, path: \`${cp.path}\`\n`
        }
      }

      const model = await getModel()
      const { streamText } = await import('ai')

      const result = streamText({
        model: model as unknown,
        system: systemPrompt,
        messages: body.messages,
        tools: buildTools(app, moduleNames, linkGraph, body.navigationOverride, body.defaultNavigation as unknown[]),
        // 10 steps accommodates multi-step analytics workflows: discovery → sample → main query
        // → error recovery → refined query → synthesis → render_component → follow-up.
        // 5 was too tight for anything involving cross-table joins + HogQL syntax iterations.
        maxSteps: 10,
        // The AI SDK masks stream-time errors as "An error occurred." on the wire (security
        // default). Without server-side logging here, prod failures are completely invisible
        // — past incident: a single bad Zod schema killed the whole chat with no signal.
        onError: ({ error }) => {
          const e = error as Error & { cause?: unknown; status?: number; statusCode?: number }
          console.error('[ai/chat][stream-error]', {
            message: e?.message,
            name: e?.name,
            status: e?.status ?? e?.statusCode,
            cause: e?.cause,
            stack: e?.stack?.split('\n').slice(0, 8).join('\n'),
          })
        },
      })

      return result.toDataStreamResponse()
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 })
    }
  }
}
