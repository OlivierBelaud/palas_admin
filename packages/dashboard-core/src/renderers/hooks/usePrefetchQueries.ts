// Query consolidation — reads all block queries from a page spec,
// merges graph queries by entity, and prefetches into TanStack Query cache.

import { useMantaClient } from '@manta/sdk'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import type { BlockDef, NamedQueryDef } from '../../primitives'
import { isGraphQuery, isNamedQuery } from '../../primitives'

interface ConsolidatedGraphQuery {
  entity: string
  fields: string[]
  relations: string[]
  filters?: Record<string, unknown>
  pagination?: { limit?: number; offset?: number }
  sort?: { field?: string; order?: 'asc' | 'desc' }
}

/**
 * Extract all queries from page blocks, consolidate graph queries by entity,
 * and prefetch into TanStack Query cache.
 */
export function usePrefetchQueries(blocks: BlockDef[], params?: Record<string, string>) {
  const queryClient = useQueryClient()
  const client = useMantaClient()

  // Extract and consolidate queries
  const consolidated = useMemo(() => {
    const graphByEntity = new Map<string, ConsolidatedGraphQuery>()
    const namedQueries: NamedQueryDef[] = []

    for (const block of blocks) {
      if (!block.query) continue

      if (isGraphQuery(block.query)) {
        const g = block.query.graph
        const entityKey = String(g.entity)
        const existing = graphByEntity.get(entityKey)

        if (existing) {
          // Merge fields
          if (g.fields) {
            for (const f of g.fields) {
              if (!existing.fields.includes(f)) existing.fields.push(f)
            }
          }
          // Merge relations
          if (g.relations) {
            for (const r of g.relations) {
              if (!existing.relations.includes(r)) existing.relations.push(r)
            }
          }
          // Keep first pagination/sort/filters (don't overwrite)
          if (g.filters && !existing.filters) existing.filters = g.filters
          if (g.pagination && !existing.pagination) existing.pagination = g.pagination
          if (g.sort && !existing.sort) existing.sort = g.sort
        } else {
          graphByEntity.set(entityKey, {
            entity: entityKey,
            fields: [...(g.fields ?? [])],
            relations: [...(g.relations ?? [])],
            filters: g.filters,
            pagination: g.pagination,
            sort: g.sort,
          })
        }
      } else if (isNamedQuery(block.query)) {
        namedQueries.push(block.query)
      }
      // HogQL blocks are NOT prefetched — they fetch lazily via useBlockQuery's
      // internal TanStack useQuery against the /api/admin/posthog/hogql relay.
      // The old catch-all `else` branch miscasted them as NamedQueryDef and called
      // client.query(undefined) → GET /api/admin/undefined → 404.
    }

    return { graphQueries: Array.from(graphByEntity.values()), namedQueries }
  }, [blocks])

  // Prefetch consolidated queries
  useEffect(() => {
    // Resolve :id params in filters
    const resolveParam = (value: unknown): unknown => {
      if (typeof value === 'string' && value.startsWith(':') && params) {
        return params[value.slice(1)] ?? value
      }
      return value
    }

    for (const gq of consolidated.graphQueries) {
      const config = {
        entity: gq.entity,
        fields: gq.fields.length > 0 ? gq.fields : undefined,
        relations: gq.relations.length > 0 ? gq.relations : undefined,
        filters: gq.filters
          ? Object.fromEntries(Object.entries(gq.filters).map(([k, v]) => [k, resolveParam(v)]))
          : undefined,
        pagination: gq.pagination,
        sort: gq.sort,
      }

      queryClient.prefetchQuery({
        queryKey: ['manta', 'graph', config.entity, config],
        queryFn: () => client.graphQuery(config),
      })
    }

    for (const nq of consolidated.namedQueries) {
      // Resolve :param placeholders in named query input
      const resolvedInput = nq.input
        ? Object.fromEntries(Object.entries(nq.input).map(([k, v]) => [k, resolveParam(v)]))
        : undefined
      // Skip prefetch if any param is still unresolved
      const hasUnresolved =
        resolvedInput &&
        Object.values(resolvedInput).some((v) => typeof v === 'string' && (v as string).startsWith(':'))
      if (hasUnresolved) continue

      queryClient.prefetchQuery({
        queryKey: ['manta', 'query', nq.name, resolvedInput],
        queryFn: () => client.query(nq.name, resolvedInput as Record<string, unknown>),
      })
    }
  }, [consolidated, queryClient, client, params])
}
