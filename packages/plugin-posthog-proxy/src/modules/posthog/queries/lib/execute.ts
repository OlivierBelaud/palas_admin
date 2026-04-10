// PostHog HogQL execution — runs SQL against the PostHog query endpoint and normalizes results.

import type { GraphQueryConfig } from '@manta/core'
import { MantaError } from '@manta/core'
import { DEFAULT_SORT, ENTITY_TO_TABLE } from './schema'
import { normalizeRow, translateFilters } from './translate'

export interface PostHogConnection {
  host: string
  personalApiKey: string
}

/**
 * Read PostHog connection info from environment variables. No plugin config — pure env.
 * Throws MantaError if the personal API key is missing, so the caller (AI or HTTP) sees a clear message.
 */
export function readPostHogConnection(): PostHogConnection {
  const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
  const personalApiKey = process.env.POSTHOG_API_KEY
  if (!personalApiKey) {
    throw new MantaError('INVALID_DATA', 'POSTHOG_API_KEY env var not set — cannot query PostHog data warehouse.')
  }
  return { host, personalApiKey }
}

/**
 * Resolve a query that targets posthogEvent or posthogPerson via HogQL.
 *
 * Entity name normalization: the extendQueryGraph() framework does a case-insensitive
 * match when deciding which extension owns an entity, but passes the caller's original
 * string to the resolver. Callers can therefore use 'posthogEvent', 'PostHogEvent', or
 * 'posthogevent' (e.g. when the AI system prompt lowercases module names). We normalize
 * against the canonical keys of ENTITY_TO_TABLE so every downstream lookup
 * (translateFilters, normalizeRow) gets the canonical name.
 */
export async function executeHogQL(query: GraphQueryConfig): Promise<Record<string, unknown>[]> {
  const rawEntity = query.entity as string
  const canonicalEntity = Object.keys(ENTITY_TO_TABLE).find((k) => k.toLowerCase() === rawEntity.toLowerCase())
  if (!canonicalEntity) {
    throw new MantaError(
      'INVALID_DATA',
      `Unknown PostHog entity: ${rawEntity}. Known: ${Object.keys(ENTITY_TO_TABLE).join(', ')}`,
    )
  }
  const entity = canonicalEntity
  const table = ENTITY_TO_TABLE[entity]

  const { host, personalApiKey } = readPostHogConnection()
  const whereClause = translateFilters(entity, query.filters)
  const limit = query.pagination?.limit ?? 100
  const offset = query.pagination?.offset ?? 0
  // Each ClickHouse table has its own time column — events.timestamp, persons.created_at.
  // Pick the right one from DEFAULT_SORT, or skip ORDER BY entirely if no default is known.
  const orderByClause = DEFAULT_SORT[entity] ? `ORDER BY ${DEFAULT_SORT[entity]}` : ''

  const hogql = `SELECT * FROM ${table} ${whereClause} ${orderByClause} LIMIT ${limit} OFFSET ${offset}`
    .replace(/\s+/g, ' ')
    .trim()

  const res = await fetch(`${host}/api/projects/@current/query/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${personalApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: hogql } }),
  })

  if (!res.ok) {
    throw new MantaError('INVALID_DATA', `PostHog HogQL returned ${res.status}: ${await res.text()}`)
  }

  const data = (await res.json()) as { results?: unknown[][]; columns?: string[] }
  if (!data.results || !data.columns) return []

  return data.results.map((row) => {
    const obj: Record<string, unknown> = {}
    data.columns?.forEach((col, idx) => {
      obj[col] = row[idx]
    })
    return normalizeRow(entity, obj)
  })
}

/**
 * Resolve posthogInsight via PostHog's REST endpoint (not HogQL — insights have their own API).
 */
export async function executeInsights(query: GraphQueryConfig): Promise<Record<string, unknown>[]> {
  const { host, personalApiKey } = readPostHogConnection()
  const params = new URLSearchParams()
  params.set('limit', String(query.pagination?.limit ?? 100))
  if (query.filters?.id) params.set('short_id', String(query.filters.id))

  const res = await fetch(`${host}/api/projects/@current/insights/?${params}`, {
    headers: { Authorization: `Bearer ${personalApiKey}` },
  })
  if (!res.ok) {
    throw new MantaError('INVALID_DATA', `PostHog Insights API returned ${res.status}: ${await res.text()}`)
  }

  const data = (await res.json()) as { results?: Array<Record<string, unknown>> }
  return (data.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    shortId: r.short_id,
    filters: r.filters,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}
