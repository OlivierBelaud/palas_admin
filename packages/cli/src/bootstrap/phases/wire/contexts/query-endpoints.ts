// [13f] V2 query endpoints + [13g] Query graph endpoints.

import { getEntityFilter } from '@manta/core'
import { getRequestBody } from '../../../../server-bootstrap'
import type { AppRef, BootstrapContext } from '../../../bootstrap-context'
import { parseBearer } from '../auth-helpers'

export async function queryEndpoints(ctx: BootstrapContext, appRef: AppRef): Promise<void> {
  const { logger, resources, queryRegistry, queryGraphDefs, adapter, contextRegistry } = ctx

  // [13f] V2: Register query endpoints
  if (resources.queries.length > 0) {
    for (const queryInfo of resources.queries) {
      const queryDef = queryRegistry.get(queryInfo.id)
      if (!queryDef) continue

      const ctx2 = contextRegistry.list().find((c: any) => c.name === queryInfo.context)
      if (!ctx2) {
        logger.warn(`Query '${queryInfo.id}' has context '${queryInfo.context}' but no matching context found`)
        continue
      }

      adapter.registerRoute('GET', `${ctx2.basePath}/${queryInfo.id}`, async (req: Request) => {
        try {
          const url = new URL(req.url, 'http://localhost')
          const rawParams: Record<string, unknown> = {}
          for (const [key, value] of url.searchParams.entries()) {
            if (value === 'true') rawParams[key] = true
            else if (value === 'false') rawParams[key] = false
            else if (/^\d+$/.test(value)) rawParams[key] = Number(value)
            else rawParams[key] = value
          }

          const authCtx = await parseBearer(ctx, req)

          const reqHeaders: Record<string, string | undefined> = {}
          req.headers.forEach((v, k) => {
            reqHeaders[k] = v
          })

          const input = queryDef.input.parse(rawParams)
          const result = await queryDef.handler(input, {
            query: appRef.current!.resolve('queryService'),
            log: logger,
            auth: authCtx,
            headers: reqHeaders,
          })
          return Response.json({ data: result })
        } catch (err) {
          if ((err as { name?: string }).name === 'ZodError') {
            return Response.json(
              { type: 'INVALID_DATA', message: 'Validation failed', details: (err as { issues?: unknown }).issues },
              { status: 400 },
            )
          }
          const message = (err as Error).message
          logger.error(`[query] ${queryInfo.id}: ${message}`)
          return Response.json({ type: 'UNEXPECTED_STATE', message }, { status: 500 })
        }
      })

      logger.info(`  Query endpoint: GET ${ctx2.basePath}/${queryInfo.id}`)
    }
  }

  // [13g] Register query graph endpoints — POST {basePath}/graph
  if (queryGraphDefs.size > 0) {
    for (const [ctxName, graphDef] of queryGraphDefs) {
      const ctx2 = contextRegistry.list().find((c: any) => c.name === ctxName)
      if (!ctx2) {
        logger.warn(`QueryGraph for context '${ctxName}' has no matching context`)
        continue
      }

      adapter.registerRoute('POST', `${ctx2.basePath}/graph`, async (req: Request) => {
        try {
          const body = await getRequestBody<{
            entity?: string
            filters?: Record<string, unknown>
            pagination?: { limit?: number; offset?: number }
            sort?: { field?: string; order?: 'asc' | 'desc' }
            relations?: string[]
            fields?: string[]
            q?: string
          }>(req)

          if (!body.entity) {
            return Response.json({ type: 'INVALID_DATA', message: 'entity is required' }, { status: 400 })
          }

          const authCtx = await parseBearer(ctx, req)

          const typedDef = graphDef as unknown as import('@manta/core').QueryGraphDefinition
          const entityFilter = getEntityFilter(typedDef, body.entity, authCtx)
          if (entityFilter === null) {
            return Response.json(
              { type: 'FORBIDDEN', message: `Entity "${body.entity}" is not accessible in this context` },
              { status: 403 },
            )
          }

          const mergedFilters = { ...(body.filters ?? {}), ...(entityFilter ?? {}) }

          const allowedRelations = (body.relations ?? []).filter((rel) => {
            const relFilter = getEntityFilter(typedDef, rel, authCtx)
            if (relFilter === null) {
              logger.warn(`[query-graph:${ctxName}] Relation "${rel}" not allowed — stripped from query`)
              return false
            }
            return true
          })

          // biome-ignore lint/suspicious/noExplicitAny: queryService.graph config shape
          const queryService = appRef.current!.resolve('queryService') as any
          const graphConfig = {
            entity: body.entity,
            filters: Object.keys(mergedFilters).length > 0 ? mergedFilters : undefined,
            pagination: body.pagination ? { limit: body.pagination.limit, offset: body.pagination.offset } : undefined,
            sort: body.sort ? { [body.sort.field!]: body.sort.order ?? 'asc' } : undefined,
            fields: body.fields,
            relations: allowedRelations.length > 0 ? allowedRelations : undefined,
            q: body.q,
          }

          const debug = new URL(req.url).searchParams.get('_debug') === '1'
          const logs: string[] = []
          if (debug) {
            process.env.MANTA_DEBUG_FILTERS_CAPTURE = '1'
            ;(globalThis as unknown as { __mantaDebugLogs?: string[] }).__mantaDebugLogs = logs
            logs.push(
              `ROUTE: debug=1 set, envNow=${process.env.MANTA_DEBUG_FILTERS_CAPTURE} globalSet=${Boolean((globalThis as unknown as { __mantaDebugLogs?: string[] }).__mantaDebugLogs)}`,
            )
            // Also try resolving the relationalQuery directly and check class name
            try {
              const rq = appRef.current!.resolve('relationalQuery') as unknown as { constructor?: { name?: string } } | null
              logs.push(`ROUTE: relationalQuery.class=${rq?.constructor?.name ?? 'NULL'}`)
            } catch (e) {
              logs.push(`ROUTE: relationalQuery resolve failed: ${(e as Error).message}`)
            }
            try {
              const qs = queryService as unknown as { _relationalQuery?: { constructor?: { name?: string } } }
              logs.push(`ROUTE: queryService._relationalQuery.class=${qs._relationalQuery?.constructor?.name ?? 'NULL'}`)
            } catch (e) {
              logs.push(`ROUTE: queryService inspect failed: ${(e as Error).message}`)
            }
          }

          // Use graphAndCount when pagination is requested, to return total count
          if (body.pagination && typeof queryService.graphAndCount === 'function') {
            const [data, count] = await queryService.graphAndCount(graphConfig)
            if (debug) {
              delete process.env.MANTA_DEBUG_FILTERS_CAPTURE
              return Response.json({ data, count, _logs: logs, _graphConfig: graphConfig })
            }
            return Response.json({ data, count })
          }

          const result = await queryService.graph(graphConfig)
          if (debug) {
            delete process.env.MANTA_DEBUG_FILTERS_CAPTURE
            return Response.json({ data: result, _logs: logs, _graphConfig: graphConfig })
          }
          return Response.json({ data: result })
        } catch (err) {
          const message = (err as Error).message
          logger.error(`[query-graph:${ctxName}] ${message}`)
          return Response.json({ type: 'UNEXPECTED_STATE', message }, { status: 500 })
        }
      })

      logger.info(
        `  QueryGraph: POST ${ctx2.basePath}/graph (${(graphDef as unknown as import('@manta/core').QueryGraphDefinition).access === '*' ? 'wildcard' : `${Object.keys((graphDef as unknown as import('@manta/core').QueryGraphDefinition).access).length} entities`})`,
      )
    }
  }
}
