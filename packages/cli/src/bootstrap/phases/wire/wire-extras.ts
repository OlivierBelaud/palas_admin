// Phase 5d: AI chat + PostHog HogQL relay + dashboard registry + custom/module API routes + OpenAPI.
// Covers [14] AI + dashboard registry, [14b-14c] custom + module API routes, [15] OpenAPI spec + Swagger.

import { getRequestBody } from '../../../server-bootstrap'
import type { AppRef, BootstrapContext } from '../../bootstrap-context'
import { isDmlEntity } from '../../bootstrap-helpers'
import { wireWorkflowRoutes } from './wire-workflow-routes'

export async function wireExtras(ctx: BootstrapContext, appRef: AppRef): Promise<void> {
  const {
    logger,
    resources,
    cwd,
    config,
    doImport,
    entityRegistry,
    loadedLinks,
    cmdRegistry,
    resolvedPlugins,
    adapter,
    contextRegistry,
  } = ctx

  // [14] AI + Dashboard registry
  let aiEnabled = false
  const aiProvider = process.env.MANTA_AI_PROVIDER || 'anthropic'
  const aiKeyEnv =
    aiProvider === 'openai'
      ? 'OPENAI_API_KEY'
      : aiProvider === 'google'
        ? 'GOOGLE_GENERATIVE_AI_API_KEY'
        : aiProvider === 'mistral'
          ? 'MISTRAL_API_KEY'
          : 'ANTHROPIC_API_KEY'

  if (process.env[aiKeyEnv]) {
    try {
      const { createAiChatHandler } = await import('../../../ai/chat-handler')
      const allEntityNames = Array.from(entityRegistry.keys()).map((k) => k.toLowerCase())
      const discoveredModuleNames = [...new Set([...resources.modules.map((m: any) => m.name), ...allEntityNames])]
      const aiLinkGraph = loadedLinks
        .filter((l) => !(l as { isDirectFk?: boolean }).isDirectFk)
        .map((l) => ({
          left: (l as { leftEntity: string }).leftEntity.toLowerCase(),
          right: (l as { rightEntity: string }).rightEntity.toLowerCase(),
          pivot: (l as { tableName: string }).tableName,
          cardinality: (l as { cardinality: string }).cardinality,
        }))
      const aiHandler = createAiChatHandler(appRef.current!, discoveredModuleNames, aiLinkGraph)
      adapter.registerRoute('POST', '/api/admin/ai/chat', aiHandler)
      aiEnabled = true
      logger.info('[ai] AI chat endpoint registered: POST /api/admin/ai/chat')
    } catch (err) {
      logger.warn(`[ai] AI chat not available: ${(err as Error).message}`)
    }
  } else {
    logger.info(`[ai] AI disabled (${aiKeyEnv} not set)`)
  }

  // ── PostHog HogQL relay endpoint ───────────────────────────────────────
  if (process.env.POSTHOG_API_KEY) {
    adapter.registerRoute('POST', '/api/admin/posthog/hogql', async (req: Request) => {
      try {
        const body = await getRequestBody<{ query?: string }>(req)
        const raw = typeof body.query === 'string' ? body.query.trim() : ''
        if (!raw) {
          return Response.json({ type: 'INVALID_DATA', message: 'query is required' }, { status: 400 })
        }
        if (!/^(with|select)\b/i.test(raw)) {
          return Response.json(
            {
              type: 'INVALID_DATA',
              message: 'Only SELECT or WITH…SELECT queries are allowed. This endpoint is read-only.',
            },
            { status: 400 },
          )
        }
        const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
        const key = process.env.POSTHOG_API_KEY
        const res = await fetch(`${host}/api/projects/@current/query/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: { kind: 'HogQLQuery', query: raw } }),
        })
        if (!res.ok) {
          const text = await res.text()
          return Response.json(
            { type: 'UNEXPECTED_STATE', message: `PostHog HogQL ${res.status}`, detail: text },
            { status: 502 },
          )
        }
        const data = (await res.json()) as {
          results?: unknown[][]
          columns?: string[]
          types?: string[]
        }
        if (!data.results || !data.columns) {
          return Response.json({ data: { columns: [], rows: [], rowCount: 0 } })
        }
        const rows = data.results.slice(0, 500).map((row) => {
          const obj: Record<string, unknown> = {}
          data.columns?.forEach((col, idx) => {
            obj[col] = row[idx]
          })
          return obj
        })
        return Response.json({
          data: {
            columns: data.columns,
            rows,
            rowCount: data.results.length,
            truncated: data.results.length > 500,
          },
        })
      } catch (err) {
        return Response.json({ type: 'UNEXPECTED_STATE', message: (err as Error).message }, { status: 500 })
      }
    })
    logger.info('[posthog] HogQL relay endpoint registered: POST /api/admin/posthog/hogql')
  }

  // GET /api/admin/registry — dashboard config
  let adminRegistry: Record<string, unknown> = { pages: {}, components: {}, navigation: [] }
  try {
    const { existsSync } = await import('node:fs')
    const { resolve: resolvePath } = await import('node:path')
    const registryPath = resolvePath(cwd, 'src', 'admin', 'registry.ts')
    if (existsSync(registryPath)) {
      const mod = await doImport(registryPath)
      adminRegistry = (mod.default ?? mod) as Record<string, unknown>
      logger.info('[dashboard] Registry loaded from src/admin/registry.ts')
    }
  } catch (err) {
    logger.warn(`[dashboard] Failed to load registry: ${(err as Error).message}`)
  }

  // Auto-generate navigation from discovered modules if registry has none.
  // URL segments use the raw on-disk directory name (kebab-friendly).
  const navItems = adminRegistry.navigation as Array<Record<string, unknown>>
  if (navItems.length === 0 && resources.modules.length > 0) {
    for (const mod of resources.modules) {
      const label = mod.dirName.charAt(0).toUpperCase() + mod.dirName.slice(1)
      const subItems = mod.entities.map((e: any) => ({
        label: e.name.replace(/([A-Z])/g, ' $1').trim(),
        to: `/${mod.dirName}/${e.name
          .toLowerCase()
          .replace(/([a-z])([A-Z])/g, '$1-$2')
          .toLowerCase()}`,
      }))
      navItems.push({
        icon: 'Users',
        label,
        to: `/${mod.dirName}`,
        items: subItems.length > 1 ? subItems : [],
      })
    }
    logger.info(`[dashboard] Auto-generated navigation (${navItems.length} entries from modules)`)
  }

  adapter.registerRoute('GET', '/api/admin/registry', async () => {
    return Response.json({
      ...adminRegistry,
      endpoints: {
        query: '/api/admin/query',
        command: '/api/admin/command',
        tools: '/api/admin/tools',
      },
      ai: { enabled: aiEnabled },
    })
  })

  // Framework-owned workflow introspection endpoints (GET/DELETE /_workflow/:id)
  await wireWorkflowRoutes(ctx, appRef)

  // [14b] Register custom API routes (plugins + local src/api/)
  {
    const { mergePluginApiRoutes } = await import('../../../plugins/merge-resources')
    const apiRoutes = await mergePluginApiRoutes(resolvedPlugins, cwd)
    for (const route of apiRoutes) {
      const mod = await doImport(route.file)
      const handler = mod[route.exportName] as (req: Request) => Promise<Response> | Response
      if (typeof handler !== 'function') continue

      adapter.registerRoute(route.method, route.path, async (req: Request) => {
        const mantaReq = req as Request & { app?: unknown; scope?: unknown; params?: Record<string, string> }
        if (!mantaReq.app)
          Object.defineProperty(mantaReq, 'app', { value: appRef.current!, enumerable: true, configurable: true })
        if (!mantaReq.scope)
          Object.defineProperty(mantaReq, 'scope', {
            value: { resolve: <T>(k: string) => appRef.current!.resolve<T>(k) },
            enumerable: true,
            configurable: true,
          })
        return handler(mantaReq)
      })
      logger.info(`  Route: ${route.method} ${route.path}`)
    }
    if (apiRoutes.length > 0) {
      logger.info(`[api] ${apiRoutes.length} custom route(s) registered`)
    }
  }

  // [14c] Register intra-module API routes
  {
    const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'])
    let moduleRouteCount = 0
    for (const modInfo of resources.modules) {
      for (const routeInfo of modInfo.apiRoutes) {
        try {
          const mod = await doImport(routeInfo.file)
          const segments = routeInfo.relativePath
            ? routeInfo.relativePath
                .split('/')
                .map((seg: string) => {
                  if (seg.startsWith('[...') && seg.endsWith(']')) return '**'
                  if (seg.startsWith('[') && seg.endsWith(']')) return `:${seg.slice(1, -1)}`
                  return seg
                })
                .join('/')
            : ''
          const urlPath = segments ? `/api/${modInfo.dirName}/${segments}` : `/api/${modInfo.dirName}`

          for (const exportName of Object.keys(mod)) {
            if (!HTTP_METHODS.has(exportName)) continue
            const handler = mod[exportName] as (req: Request) => Promise<Response> | Response
            if (typeof handler !== 'function') continue

            adapter.registerRoute(exportName, urlPath, async (req: Request) => {
              const mantaReq = req as Request & { app?: unknown; scope?: unknown }
              if (!mantaReq.app)
                Object.defineProperty(mantaReq, 'app', { value: appRef.current!, enumerable: true, configurable: true })
              if (!mantaReq.scope)
                Object.defineProperty(mantaReq, 'scope', {
                  value: { resolve: <T>(k: string) => appRef.current!.resolve<T>(k) },
                  enumerable: true,
                  configurable: true,
                })
              return handler(mantaReq)
            })
            logger.info(`  Route: ${exportName} ${urlPath} (module: ${modInfo.dirName})`)
            moduleRouteCount++
          }
        } catch (err) {
          logger.warn(
            `Failed to load module route '${modInfo.dirName}/${routeInfo.relativePath}': ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }
    if (moduleRouteCount > 0) {
      logger.info(`[api] ${moduleRouteCount} module route(s) registered`)
    }
  }

  // [15] OpenAPI spec + Swagger UI
  try {
    const { generateOpenApiSpec, parseDmlEntityFields } = await import('../../../openapi/generate-spec')
    const { getSwaggerHtml } = await import('../../../openapi/swagger-html')

    const openApiEntities: Array<{
      name: string
      moduleName?: string
      fields: Array<{ name: string; type: string; nullable?: boolean; values?: unknown }>
    }> = []
    for (const modInfo of resources.modules) {
      try {
        const mod = await doImport(modInfo.path)
        for (const value of Object.values(mod)) {
          if (isDmlEntity(value) && typeof value.getOptions === 'function') {
            openApiEntities.push({
              name: value.name,
              moduleName: modInfo.name,
              fields: parseDmlEntityFields(value.schema),
            })
          }
        }
      } catch {
        /* skip modules that fail to import */
      }
    }

    const openApiCommands = cmdRegistry
      ? cmdRegistry.list().map((entry: any) => ({
          name: entry.name,
          description: entry.description,
          inputSchema: entry.inputSchema,
        }))
      : []

    const staticRoutes: Array<{
      method: string
      path: string
      summary?: string
      tags?: string[]
      auth?: boolean
    }> = []

    const primaryContext = contextRegistry.list()[0]
    const openApiBasePath = primaryContext?.basePath ?? '/api'

    const configRecord = config as Record<string, unknown>
    adapter.registerRoute('GET', '/api/openapi.json', async () => {
      const spec = generateOpenApiSpec({
        title: (configRecord.name as string | undefined) ?? 'Manta API',
        version: (configRecord.version as string | undefined) ?? '1.0.0',
        description: configRecord.description as string | undefined,
        basePath: openApiBasePath,
        commands: openApiCommands,
        entities: openApiEntities,
        routes: staticRoutes.length > 0 ? staticRoutes : undefined,
      })
      return Response.json(spec)
    })

    adapter.registerRoute('GET', '/api/docs', async () => {
      const html = getSwaggerHtml('/api/openapi.json')
      return new Response(html, { headers: { 'Content-Type': 'text/html' } })
    })

    logger.info('[openapi] Swagger UI: GET /api/docs | OpenAPI spec: GET /api/openapi.json')
  } catch (err) {
    logger.warn(`[openapi] Failed to register OpenAPI routes: ${(err as Error).message}`)
  }
}
