// [13e] Register context-aware CQRS endpoints.

import { getRequestBody } from '../../../../server-bootstrap'
import type { AppRef, BootstrapContext } from '../../../bootstrap-context'
import { parseBearer } from '../auth-helpers'
import { handleQueryRequest } from '../wire-adapter'

export async function cqrsRoutes(ctx: BootstrapContext, appRef: AppRef): Promise<void> {
  const { logger, adapter, contextRegistry } = ctx

  // [13e] Register context-aware CQRS endpoints
  for (const ctx2 of contextRegistry.list()) {
    // POST {basePath}/command/:name — filtered by context
    adapter.registerRoute('POST', `${ctx2.basePath}/command/:name`, async (req: Request) => {
      try {
        const url = new URL(req.url, 'http://localhost')
        const segments = url.pathname.split('/')
        const nameIdx = segments.indexOf('command') + 1
        const name = segments[nameIdx]

        const camelName = name.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase())
        if (!ctx2.commands.has(name) && !ctx2.commands.has(camelName)) {
          return Response.json(
            { type: 'NOT_FOUND', message: `Command "${name}" not found in context "${ctx2.name}"` },
            { status: 404 },
          )
        }

        const cmds = appRef.current!.commands as Record<string, ((...args: unknown[]) => Promise<unknown>) | undefined>
        const callable = cmds[name] ?? cmds[camelName]
        if (!callable) {
          return Response.json({ type: 'NOT_FOUND', message: `Command "${name}" not found` }, { status: 404 })
        }
        const body = await getRequestBody(req)

        const cmdAuth = await parseBearer(ctx, req)
        const reqHeaders: Record<string, string | undefined> = {}
        req.headers.forEach((v, k) => {
          reqHeaders[k] = v
        })

        const result = await callable(body, { auth: cmdAuth, headers: reqHeaders })
        return Response.json({ data: result })
      } catch (err) {
        if ((err as { name?: string }).name === 'ZodError') {
          return Response.json(
            { type: 'INVALID_DATA', message: 'Validation failed', details: (err as { issues?: unknown }).issues },
            { status: 400 },
          )
        }
        const message = (err as Error).message
        logger.error(`[command] ${message}`)
        return Response.json({ type: 'UNEXPECTED_STATE', message }, { status: 500 })
      }
    })

    // POST {basePath}/query/:entity — filtered by context
    adapter.registerRoute('POST', `${ctx2.basePath}/query/:entity`, async (req: Request) => {
      try {
        const url = new URL(req.url, 'http://localhost')
        const segments = url.pathname.split('/')
        const entityIdx = segments.indexOf('query') + 1
        const entity = segments[entityIdx]

        if (!entity) {
          return Response.json({ type: 'INVALID_DATA', message: 'entity is required in URL' }, { status: 400 })
        }

        const entityNormalized = entity.toLowerCase()
        if (!ctx2.modules.has(entity) && !ctx2.modules.has(entityNormalized)) {
          return Response.json(
            { type: 'NOT_FOUND', message: `Entity "${entity}" not available in context "${ctx2.name}"` },
            { status: 404 },
          )
        }

        let service: Record<string, unknown> | null = null
        const modules = appRef.current!.modules as Record<string, Record<string, unknown> | undefined>
        try {
          service = appRef.current!.resolve<Record<string, unknown>>(`${entity}ModuleService`)
        } catch {
          service = modules[entity] ?? modules[entityNormalized] ?? null
        }
        if (!service) {
          return Response.json({ type: 'NOT_FOUND', message: `Entity "${entity}" not found` }, { status: 404 })
        }

        const body = await getRequestBody<Record<string, unknown>>(req)

        const qs = (() => {
          try {
            return appRef.current!.resolve('queryService') as { graphAndCount: Function }
          } catch {
            return null
          }
        })()
        if (qs && typeof qs.graphAndCount === 'function') {
          const { fields, filters, limit, offset, order, q, id } = body as Record<string, unknown>

          if (id) {
            return handleQueryRequest(service, entity, body, {
              contextName: ctx2.name,
              exposedModules: new Set(ctx2.modules.keys()),
              logger,
            })
          }

          const sortObj =
            order && typeof order === 'string'
              ? { [order.startsWith('-') ? order.slice(1) : order]: order.startsWith('-') ? 'desc' : 'asc' }
              : undefined
          const [data, count] = await qs.graphAndCount({
            entity,
            fields: fields as string[] | undefined,
            filters: filters as Record<string, unknown> | undefined,
            sort: sortObj,
            pagination: { limit: (limit as number) ?? 15, offset: (offset as number) ?? 0 },
            q: q as string | undefined,
          })
          return Response.json({ data, count })
        }

        return handleQueryRequest(service, entity, body, {
          contextName: ctx2.name,
          exposedModules: new Set(ctx2.modules.keys()),
          logger,
        })
      } catch (err) {
        return Response.json({ type: 'UNEXPECTED_STATE', message: (err as Error).message }, { status: 500 })
      }
    })

    // GET {basePath}/tools — AI tool discovery (filtered by context)
    if (ctx2.ai.enabled) {
      adapter.registerRoute('GET', `${ctx2.basePath}/tools`, async () => {
        try {
          const registry = appRef.current!.resolve<import('@manta/core').CommandRegistry>('commandRegistry')
          const aiCommands = ctx2.ai.commands
          const filtered = registry.toToolSchemas().filter((t) => aiCommands.includes(t.name))
          return Response.json({ tools: filtered })
        } catch {
          return Response.json({ tools: [] })
        }
      })
    }

    logger.info(
      `[context] ${ctx2.name}: ${ctx2.basePath} (actors: ${ctx2.actors.join(', ')}, modules: ${[...ctx2.modules.keys()].join(', ')})`,
    )
  }
}
