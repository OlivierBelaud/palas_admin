// Phase 5c: Contexts, user routes, context-aware CQRS, SPA warnings.
// Covers [13b-v2] SPA warnings, [13c] user routes, [13d] context registry,
// [13e] context-aware CQRS, [13f] V2 query endpoints, [13g] query graph endpoints.

import { ContextRegistry, generateAllUserRoutes, getEntityFilter, getPublicPaths, isCommandAllowed } from '@manta/core'
import type { ICachePort } from '@manta/core/ports'
import { getRequestBody } from '../../../server-bootstrap'
import type { AppRef, BootstrapContext } from '../../bootstrap-context'
import { ensureEntityTables } from '../../bootstrap-helpers'
import { handleQueryRequest } from './wire-adapter'

export async function wireContexts(ctx: BootstrapContext, appRef: AppRef): Promise<void> {
  const {
    logger,
    db,
    infraMap,
    repoFactory,
    resources,
    mode,
    doImport,
    generatedTables,
    entityRegistry,
    entityCommandRegistry,
    explicitCommandNames,
    commandGraphDefs,
    queryRegistry,
    userDefinitions,
    moduleScopedCommandNames,
    cmdRegistry,
    generatePgTableFromDml,
    adapter,
    authService,
    jwtSecret,
  } = ctx

  // [13b-v2] SPA warnings
  if (resources.spas.length > 0) {
    const userContexts = new Set(userDefinitions.map((u: any) => u.contextName))
    for (const spa of resources.spas) {
      if (!userContexts.has(spa.name) && spa.name !== 'public') {
        logger.warn(`SPA "${spa.name}" has no defineUserModel('${spa.name}') — no one can login to /${spa.name}`)
      } else {
        logger.info(`  SPA: /${spa.name} (from src/spa/${spa.name}/)`)
      }
    }
  }

  // Load context middleware overrides (src/middleware/{ctx}.ts)
  const contextMiddlewareMap = new Map<string, (req: unknown, authCtx: unknown) => Promise<unknown>>()
  for (const mw of resources.contextMiddlewares) {
    try {
      const imported = await doImport(mw.path)
      // biome-ignore lint/suspicious/noExplicitAny: middleware def shape varies
      const def = imported.default as any
      if (def?.__type === 'middleware' && typeof def.handler === 'function') {
        contextMiddlewareMap.set(mw.context, def.handler)
        logger.info(`  Middleware override: ${mw.context} (${mw.path})`)
      }
    } catch (err) {
      logger.warn(`Failed to load middleware '${mw.context}': ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (userDefinitions.length > 0) {
    for (const { contextName, def } of userDefinitions) {
      try {
        const userDmlEntity = def.model
        const inviteDmlEntity = def.inviteModel

        // biome-ignore lint/suspicious/noExplicitAny: repo type varies between DrizzleRepository and InMemoryRepository
        let userRepo: any
        // biome-ignore lint/suspicious/noExplicitAny: repo type varies
        let inviteRepo: any

        let userRepoKey = userDmlEntity?.name?.toLowerCase() ?? contextName
        let inviteRepoKey = inviteDmlEntity?.name?.toLowerCase() ?? `${contextName}_invite`
        if (db && userDmlEntity && inviteDmlEntity) {
          const userTable = generatePgTableFromDml(
            userDmlEntity as unknown as Parameters<typeof generatePgTableFromDml>[0],
          )
          const inviteTable = generatePgTableFromDml(
            inviteDmlEntity as unknown as Parameters<typeof generatePgTableFromDml>[0],
          )
          userRepoKey = userTable.tableName
          inviteRepoKey = inviteTable.tableName
          generatedTables.set(userTable.tableName, userTable.table)
          generatedTables.set(inviteTable.tableName, inviteTable.table)
          repoFactory.registerTable!(userTable.tableName, userTable.table)
          repoFactory.registerTable!(inviteTable.tableName, inviteTable.table)
          await ensureEntityTables(
            db.getPool(),
            [
              { name: userDmlEntity.name, schema: (userDmlEntity as any).schema },
              { name: inviteDmlEntity.name, schema: (inviteDmlEntity as any).schema },
            ],
            [],
            logger,
          )
        }
        userRepo = repoFactory.createRepository(userRepoKey)
        inviteRepo = repoFactory.createRepository(inviteRepoKey)

        const routes = generateAllUserRoutes({
          userDef: def,
          authService: authService as unknown as Parameters<typeof generateAllUserRoutes>[0]['authService'],
          userRepo,
          inviteRepo,
          cache: infraMap.get('ICachePort') as ICachePort,
          logger,
          jwtSecret,
        })

        const overriddenNames = new Set(
          resources.commands.filter((c: any) => c.context === contextName).map((c: any) => c.id),
        )

        for (const route of routes) {
          const routeName = route.path.split('/').pop() ?? ''
          if (overriddenNames.has(routeName)) {
            logger.info(`    Route ${route.path} overridden by commands/${contextName}/${routeName}.ts`)
            continue
          }
          adapter.registerRoute(route.method, route.path, route.handler)
        }

        const publicPaths = getPublicPaths(contextName)
        // biome-ignore lint/suspicious/noExplicitAny: middleware handler types vary
        const customMw = contextMiddlewareMap.get(contextName) as any
        adapter.registerContextAuth(contextName, def.actorType, publicPaths, customMw ?? undefined)

        logger.info(`  User routes: ${contextName} (login, me, CRUD, invite) on /api/${contextName}/`)

        // Seed dev user
        if (mode === 'dev') {
          try {
            const seedEmail = `${contextName}@manta.local`
            const seedResult = await authService.register('emailpass', {
              url: '',
              headers: {},
              query: {},
              protocol: 'http',
              body: { email: seedEmail, password: process.env.MANTA_ADMIN_PASSWORD ?? 'admin' },
            })
            if (seedResult?.authIdentity) {
              await authService.updateAuthIdentity(seedResult.authIdentity.id, {
                app_metadata: { user_type: contextName },
              })
              await userRepo.create({ email: seedEmail, first_name: 'Dev', last_name: 'Admin' })
              logger.info(`[auth:${contextName}] Dev user seeded — login with: ${seedEmail}`)
            }
          } catch (seedErr) {
            logger.warn(
              `[auth:${contextName}] Dev seed: ${seedErr instanceof Error ? seedErr.message : String(seedErr)}`,
            )
          }
        }
      } catch (err) {
        logger.warn(
          `Failed to wire user routes for '${contextName}': ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // [13d] Load contexts (src/contexts/*.ts)
  const contextRegistry = new ContextRegistry()
  ctx.contextRegistry = contextRegistry
  const moduleNames = [
    ...resources.modules.map((m: any) => m.name),
    ...Array.from(entityRegistry.keys()).map((k) => k.toLowerCase()),
  ]
  const commandNames = cmdRegistry ? cmdRegistry.list().map((e: any) => e.name) : []

  // Helper: resolve entity commands visible for a context based on its command graph
  const isEntityCmdAllowed = isCommandAllowed
  const resolveEntityCommandsForContext = (ctxName: string): string[] => {
    const graphDef = commandGraphDefs.get(ctxName)
    if (!graphDef) return []

    const visibleEntityCmds: string[] = []
    for (const [cmdName, entityCmd] of entityCommandRegistry.entries()) {
      if (explicitCommandNames.has(cmdName)) continue
      if (isEntityCmdAllowed(graphDef as any, (entityCmd as any).__module, (entityCmd as any).__operation)) {
        visibleEntityCmds.push(cmdName)
      }
    }
    return visibleEntityCmds
  }

  if (resources.contexts.length > 0) {
    // V1 path: explicit defineContext files
    for (const ctxInfo of resources.contexts) {
      try {
        const imported = await doImport(ctxInfo.path)
        // biome-ignore lint/suspicious/noExplicitAny: context definition shape varies
        const def = imported.default as any
        if (def?.name && def?.basePath && def?.actors) {
          const entityCmds = resolveEntityCommandsForContext(def.name)
          if (entityCmds.length > 0) {
            def.commands = [...(def.commands ?? []), ...entityCmds]
          }
          contextRegistry.register(def, moduleNames, [...commandNames, ...entityCmds])
          logger.info(
            `  Context: ${def.name} (${def.basePath}) [V1 explicit]${entityCmds.length > 0 ? ` +${entityCmds.length} entity commands` : ''}`,
          )
        }
      } catch (err) {
        logger.warn(`Failed to load context '${ctxInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } else if (
    resources.users.length > 0 ||
    resources.queries.length > 0 ||
    resources.commands.some((c: any) => c.context)
  ) {
    // V2 path: derive contexts from filesystem structure
    const derivedContexts = new Set<string>()

    for (const cmd of resources.commands) {
      if (cmd.context) derivedContexts.add(cmd.context)
    }
    for (const q of resources.queries) {
      derivedContexts.add(q.context)
    }
    for (const u of userDefinitions) {
      derivedContexts.add(u.contextName)
    }

    const commandGraphIds = new Set<string>()
    for (const cmd of resources.commands) {
      if (cmd.context && commandGraphDefs.has(cmd.context) && cmd.id === 'graph') {
        commandGraphIds.add(`${cmd.context}:${cmd.id}`)
      }
    }

    const kebabToCamel = (s: string) => s.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase())

    for (const ctxName of derivedContexts) {
      const ctxCommands = resources.commands
        .filter((c: any) => c.context === ctxName && !commandGraphIds.has(`${c.context}:${c.id}`))
        .map((c: any) => kebabToCamel(c.id))
      const flatCommands = resources.commands.filter((c: any) => !c.context).map((c: any) => kebabToCamel(c.id))
      const entityCmds = resolveEntityCommandsForContext(ctxName)
      const allCtxCommands = [...ctxCommands, ...flatCommands, ...entityCmds, ...moduleScopedCommandNames]

      const hasUser = userDefinitions.some((u: any) => u.contextName === ctxName)
      const actors = hasUser ? [ctxName] : []

      contextRegistry.register(
        {
          name: ctxName,
          basePath: `/api/${ctxName}`,
          actors,
          modules: Object.fromEntries(moduleNames.map((m: string) => [m, { expose: '*' }])),
          commands: allCtxCommands,
        },
        moduleNames,
        [...commandNames, ...entityCmds],
      )
      logger.info(
        `  Context: ${ctxName} (/api/${ctxName}) [V2 filesystem-derived]${entityCmds.length > 0 ? ` +${entityCmds.length} entity commands` : ''}`,
      )
    }
  } else {
    contextRegistry.registerDefault(moduleNames, commandNames)
    logger.info('  Context: admin (implicit, /api/admin)')
  }

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

        const authHeader = req.headers.get('authorization')
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
        let cmdAuth: unknown = null
        if (bearerToken) {
          try {
            cmdAuth = await authService.verifyToken(bearerToken, jwtSecret)
          } catch {
            /* no auth */
          }
        }
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

          const authHeader = req.headers.get('authorization')
          const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
          let authCtx: import('@manta/core').AuthContext | null = null
          if (bearerToken) {
            try {
              authCtx = (await authService.verifyToken(
                bearerToken,
                jwtSecret,
              )) as unknown as import('@manta/core').AuthContext
            } catch {
              /* no auth */
            }
          }

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
  const _queryGraphDefs = ctx.commandGraphDefs // Note: this is a different variable from the local in assemble-modules
  // Actually, we need the queryGraphDefs from resources.queries, not from commandGraphDefs.
  // Let me re-read... The original code uses `queryGraphDefs` which was loaded in [12c].
  // Since queryGraphDefs was local in the original function, we need to rebuild or pass it.
  // We'll re-derive it from queryRegistry or pass through ctx. For now, the queryGraphDefs
  // was a local Map in the original code (not the commandGraphDefs). Let me handle this properly.

  // Re-derive queryGraphDefs from resources — they were loaded in assemble-modules [12c]
  // but not stored on ctx. We need to re-import them.
  const queryGraphDefsLocal = new Map<string, { entities: '*' | string[] }>()
  if (resources.queries.length > 0) {
    for (const queryInfo of resources.queries) {
      try {
        const imported = await doImport(queryInfo.path)
        // biome-ignore lint/suspicious/noExplicitAny: query graph def shape varies
        const def = imported.default as any
        if (def?.__type === 'query-graph') {
          queryGraphDefsLocal.set(queryInfo.context, def)
        }
      } catch {
        /* skip */
      }
    }
  }

  if (queryGraphDefsLocal.size > 0) {
    for (const [ctxName, graphDef] of queryGraphDefsLocal) {
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

          const authHeader = req.headers.get('authorization')
          const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
          let authCtx: import('@manta/core').AuthContext | null = null
          if (token) {
            try {
              authCtx = (await authService.verifyToken(
                token,
                jwtSecret,
              )) as unknown as import('@manta/core').AuthContext
            } catch {
              /* no auth */
            }
          }

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
          const result = await queryService.graph({
            entity: body.entity,
            filters: Object.keys(mergedFilters).length > 0 ? mergedFilters : undefined,
            pagination: body.pagination ? { limit: body.pagination.limit, offset: body.pagination.offset } : undefined,
            sort: body.sort ? { [body.sort.field!]: body.sort.order ?? 'asc' } : undefined,
            fields: body.fields,
            relations: allowedRelations.length > 0 ? allowedRelations : undefined,
            q: body.q,
          })

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

  logger.info('[cqrs] Context-aware endpoints registered')
}
