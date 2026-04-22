// Phase 3d: Wire command callables + relational query + QueryService.

import type { RelationAliasEntry, RelationAliasMap } from '@manta/adapter-database-pg'
import {
  buildDrizzleRelations,
  type DrizzlePgAdapter,
  DrizzleRelationalQuery,
  generateIntraModuleRelations,
  generateLinkRelations,
} from '@manta/adapter-database-pg'
import type { IProgressChannelPort, IQueuePort, IWorkflowStorePort, WorkflowStorage } from '@manta/core'
import {
  getRegisteredLinks,
  InMemoryQueueAdapter,
  MantaError,
  parseDmlEntity,
  QueryService,
  toCamel,
  WorkflowManager,
} from '@manta/core'
import type { AppRef, BootstrapContext } from '../../bootstrap-context'
import { entityToTableKey, isDmlEntity } from '../../bootstrap-helpers'

export async function wireCommands(ctx: BootstrapContext, appRef: AppRef): Promise<void> {
  const { logger, db, infraMap, repoFactory, builder, resources, doImport } = ctx
  const generatedTables = ctx.generatedTables
  const entityCommandRegistry = ctx.entityCommandRegistry as Map<
    string,
    {
      input: { parse: (input: unknown) => unknown }
      workflow: (parsed: unknown, ctx: unknown) => Promise<unknown>
    }
  >
  const explicitCommandNames = ctx.explicitCommandNames
  const queryExtensions = ctx.queryExtensions
  const userDefinitions = ctx.userDefinitions

  // [11b] Wire command callables (with WorkflowManager — uses deferred appRef)
  const cmdRegistry = builder.getCommandRegistry()
  ctx.cmdRegistry = cmdRegistry
  if (cmdRegistry) {
    const wfStorageInstance = infraMap.get('IWorkflowStoragePort') as WorkflowStorage | undefined
    const wfStoreInstance = infraMap.get('IWorkflowStorePort') as IWorkflowStorePort | undefined
    const progressChannelInstance = infraMap.get('IProgressChannelPort') as IProgressChannelPort | undefined
    // Queue adapter for serverless continuations (WORKFLOW_PROGRESS addendum —
    // ctx.yield). Resolution order:
    //   1. Explicit `IQueuePort` registered by init-infra (future QStash wiring)
    //   2. `InMemoryQueueAdapter` fallback — fire-and-forget fetch to self,
    //      fine for a long-running Node host, NOT for serverless cold-starts
    //      (messages are lost if the process dies).
    // Stash it on ctx so wire-workflow-routes.ts can re-use the same adapter
    // for the `/resume` handler.
    // Queue resolution:
    //   1. explicit IQueuePort registered by init-infra (e.g. user-wired)
    //   2. QStash if QSTASH_TOKEN + QSTASH_URL are set (prod / Vercel Upstash integration)
    //   3. InMemoryQueueAdapter fallback (dev / long-running Node)
    let queueInstance = infraMap.get('IQueuePort') as IQueuePort | undefined
    if (!queueInstance && process.env.QSTASH_TOKEN && process.env.QSTASH_URL) {
      try {
        const { QStashQueueAdapter } = await import('@manta/adapter-queue-qstash')
        queueInstance = new QStashQueueAdapter({
          url: process.env.QSTASH_URL,
          token: process.env.QSTASH_TOKEN,
          logger: {
            warn: (m: string) => logger.warn(m),
            error: (m: string, err: unknown) => logger.error(m, err),
          },
        })
        logger.info('[workflow] Queue adapter: QStash (Upstash)')
      } catch (err) {
        logger.warn(`[workflow] QStash adapter failed to load: ${(err as Error).message} — falling back to in-memory`)
      }
    }
    if (!queueInstance) {
      queueInstance = new InMemoryQueueAdapter({
        logger: {
          warn: (m: string) => logger.warn(m),
          error: (m: string, err: unknown) => logger.error(m, err),
        },
      })
      logger.info('[workflow] Queue adapter: InMemoryQueueAdapter (dev / no QStash configured)')
    }
    const baseUrl = process.env.MANTA_BASE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
    const resumeEndpoint = (runId: string) => `${baseUrl}/api/admin/_workflow/${runId}/resume`
    // Serverless time budget: on Vercel Hobby a function caps at 10s, so we
    // give steps 7s before they should yield (3s safety for TCP + response).
    // Detect Vercel via env; leave undefined otherwise so long-running Node
    // hosts don't force steps to yield unnecessarily.
    const stepBudgetMs = process.env.VERCEL ? 7_000 : undefined
    ctx.workflowQueue = queueInstance
    ctx.workflowResumeEndpoint = resumeEndpoint
    ctx.workflowStepBudgetMs = stepBudgetMs
    // 300ms short-circuit: the callable awaits the workflow up to 300ms. If it
    // finishes fast → return the inline envelope. Otherwise → return
    // { runId, status: 'running' } immediately while the workflow continues in
    // the background. See WORKFLOW_PROGRESS.md §6.1.
    const SHORT_CIRCUIT_MS = 300
    for (const entry of cmdRegistry.list()) {
      builder.registerCommandCallable(
        entry.name,
        async (input: unknown, httpCtx?: { auth?: unknown; headers?: Record<string, string | undefined> }) => {
          let parsed: unknown
          try {
            parsed = entry.inputSchema.parse(input)
          } catch (err) {
            throw MantaError.wrap(err, `command:${entry.name}`)
          }

          // Pre-generate the runId so we can surface it in the async branch
          // without awaiting the full run. WorkflowRunOptions already supports
          // a caller-supplied transactionId.
          const runId = `tx_${crypto.randomUUID().replace(/-/g, '')}`

          const wm = new WorkflowManager(appRef.current!, {
            storage: wfStorageInstance,
            store: wfStoreInstance,
            progressChannel: progressChannelInstance,
            queue: queueInstance,
            resumeEndpoint,
            stepBudgetMs,
          })
          wm.register({ name: `cmd:${entry.name}`, fn: entry.workflow })

          const runPromise = wm.run(`cmd:${entry.name}`, {
            input: parsed as Record<string, unknown>,
            transactionId: runId,
            ...(httpCtx ? { __httpCtx: httpCtx } : {}),
          })

          // Race the workflow against a 300ms timer. The host process stays
          // alive (nitro / node long-running) so the background continuation
          // can finish after the callable returns.
          let timer: ReturnType<typeof setTimeout> | null = null
          const raced = await Promise.race([
            runPromise
              .then((value) => ({ __kind: 'inline' as const, value }))
              .catch((err) => {
                return { __kind: 'error' as const, err }
              }),
            new Promise<{ __kind: 'async' }>((resolve) => {
              timer = setTimeout(() => resolve({ __kind: 'async' }), SHORT_CIRCUIT_MS)
            }),
          ])
          if (timer) clearTimeout(timer)

          if (raced.__kind === 'error') {
            throw MantaError.wrap(raced.err, `command:${entry.name}`)
          }

          if (raced.__kind === 'inline') {
            return { status: 'succeeded' as const, result: raced.value.result, runId }
          }

          // Timer won — schedule background continuation. Errors are logged
          // (terminal state is already written to the durable store by
          // WorkflowManager). Swallow here to avoid unhandled rejections.
          runPromise.catch((err) => {
            try {
              logger.warn(`[workflow:cmd:${entry.name}] background run failed: ${(err as Error)?.message ?? err}`)
            } catch {
              /* logger may be disposed on shutdown */
            }
          })

          return { runId, status: 'running' as const }
        },
      )
    }
    logger.info(`Commands: ${cmdRegistry.list().length} registered`)
  }

  // [11c] Wire entity command callables — direct service call, NO WorkflowManager
  let entityCmdCount = 0
  for (const [cmdName, entityCmd] of entityCommandRegistry.entries()) {
    if (explicitCommandNames.has(cmdName)) {
      logger.info(`  Entity command skipped (overridden): ${cmdName}`)
      continue
    }
    builder.registerCommandCallable(
      cmdName,
      async (input: unknown, _httpCtx?: { auth?: unknown; headers?: Record<string, string | undefined> }) => {
        const parsed = entityCmd.input.parse(input)
        try {
          return await entityCmd.workflow(parsed, {
            app: appRef.current!,
          } as unknown as import('@manta/core').StepContext)
        } catch (err) {
          throw MantaError.wrap(err, `entity-command:${cmdName}`)
        }
      },
    )
    entityCmdCount++
  }
  if (entityCmdCount > 0) {
    logger.info(`Entity commands: ${entityCmdCount} auto-generated`)
  }

  // [12] Wire up IRelationalQueryPort for native SQL JOINs
  logger.info(
    `[WIRE-RQ] db=${db ? db.constructor?.name ?? typeof db : 'NULL'} hasSetSchema=${
      db && typeof (db as DrizzlePgAdapter).setSchema === 'function'
    }`,
  )
  try {
    if (db && typeof (db as DrizzlePgAdapter).setSchema === 'function') {
      let frameworkTables: Record<string, unknown> = {}
      try {
        frameworkTables = await import('@manta/core/db')
      } catch {
        /* no db schema exports */
      }
      const allTables: Record<string, unknown> = { ...frameworkTables }
      const seenTableObjects = new Map<unknown, string>()
      for (const [key, table] of generatedTables) {
        const existing = seenTableObjects.get(table)
        if (existing) {
          if (!key.includes('_') && existing.includes('_')) {
            delete allTables[existing]
            allTables[key] = table
            seenTableObjects.set(table, key)
          }
        } else {
          allTables[key] = table
          seenTableObjects.set(table, key)
        }
      }

      const entityInputs = []
      for (const modInfo of resources.modules) {
        for (const entity of modInfo.entities) {
          try {
            const mod = await doImport(entity.modelPath)
            for (const [_key, value] of Object.entries(mod)) {
              if (isDmlEntity(value) && typeof value.getOptions === 'function') {
                const opts = value.getOptions() as { external?: boolean }
                if (opts.external === true) continue

                const parsed = parseDmlEntity(value)
                if (parsed.relations && parsed.relations.length > 0) {
                  entityInputs.push({
                    entityName: parsed.name,
                    tableName: `${parsed.name.toLowerCase()}s`,
                    relations: parsed.relations,
                  })
                }
              }
            }
          } catch {
            // Entity model may not export DML entities — skip silently
          }
        }
      }

      const intraDefs = generateIntraModuleRelations(entityInputs)
      const linkDefs = generateLinkRelations(getRegisteredLinks())
      const allDefs = [...intraDefs, ...linkDefs]

      const drizzleRelations = buildDrizzleRelations(allDefs, allTables as Parameters<typeof buildDrizzleRelations>[1])
      const fullSchema = { ...allTables, ...drizzleRelations }

      ;(db as DrizzlePgAdapter).setSchema(fullSchema)

      // Build relation alias map
      const getLinks2 = getRegisteredLinks
      const relationAliases: RelationAliasMap = new Map()
      const toCamelAlias = (s: string) => s.replace(/[_-]([a-z])/g, (_: string, c: string) => c.toUpperCase())
      const pluralizeAlias = (s: string) => {
        if (s.endsWith('s') || s.endsWith('x') || s.endsWith('ch') || s.endsWith('sh')) return `${s}es`
        if (s.endsWith('y') && !/[aeiou]y$/i.test(s)) return `${s.slice(0, -1)}ies`
        return `${s}s`
      }
      for (const link of getLinks2()) {
        const leftCamel = link.leftEntity
        const rightCamel = link.rightEntity
        const pivotCamel = toCamelAlias(link.tableName)
        const isManyToMany = link.cardinality === 'M:N'
        const extraCols = link.extraColumns ? Object.keys(link.extraColumns) : undefined

        const leftNorm = leftCamel.replace(/[_\s-]/g, '').toLowerCase()
        const rightNorm = rightCamel.replace(/[_\s-]/g, '').toLowerCase()

        const leftIsMany = isManyToMany || link.cascadeRight
        const rightIsMany = isManyToMany || link.cascadeLeft

        const leftAliases = relationAliases.get(leftNorm) ?? {}
        const rightAliasName = rightIsMany ? pluralizeAlias(rightCamel) : rightCamel
        const rightAliasEntry: RelationAliasEntry = { pivot: pivotCamel, through: rightCamel, extraColumns: extraCols }
        leftAliases[rightAliasName] = rightAliasEntry
        relationAliases.set(leftNorm, leftAliases)

        const rightAliases = relationAliases.get(rightNorm) ?? {}
        const leftAliasName = leftIsMany ? pluralizeAlias(leftCamel) : leftCamel
        const leftAliasEntry: RelationAliasEntry = { pivot: pivotCamel, through: leftCamel, extraColumns: extraCols }
        rightAliases[leftAliasName] = leftAliasEntry
        relationAliases.set(rightNorm, rightAliases)
      }
      logger.info(
        `Relation aliases: ${[...relationAliases.entries()].map(([e, a]) => `${e}: ${JSON.stringify(a)}`).join(', ')}`,
      )

      const rqAdapter = new DrizzleRelationalQuery((db as DrizzlePgAdapter).getClient(), {
        relationAliases,
        logger,
      })
      builder.registerInfra('IRelationalQueryPort', rqAdapter)
      logger.info(`IRelationalQueryPort → DrizzleRelationalQuery (${allDefs.length} relations, native SQL JOINs)`)
    }
  } catch (err) {
    logger.warn(`[WIRE-RQ] Failed to wire IRelationalQueryPort: ${err instanceof Error ? err.message : String(err)}`)
    logger.warn(`[WIRE-RQ] stack: ${err instanceof Error ? err.stack?.split('\n').slice(0, 3).join(' | ') : ''}`)
  }

  // [12e] Create and register QueryService for defineQueryGraph() support
  try {
    const queryService = new QueryService()

    // Wire relational query for native SQL JOINs
    try {
      // biome-ignore lint/suspicious/noExplicitAny: accessing private builder state
      const rqPort = (builder as any)._extraResolve?.get('IRelationalQueryPort')
      if (rqPort) {
        queryService.registerRelationalQuery(rqPort as import('@manta/core').IRelationalQueryPort)
        logger.info('QueryService: relational query wired for dotted field paths')
      }
    } catch {
      /* IRelationalQueryPort not available */
    }

    // Register a resolver per module entity
    for (const mod of resources.modules) {
      for (const entity of mod.entities) {
        const toCamelName = toCamel
        const entityPascal = entity.name
          .split('-')
          .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
          .join('')
        const entityCamel = toCamelName(entityPascal)
        const repoKey = entityToTableKey(entityPascal)

        queryService.registerResolver(entityCamel, async (config) => {
          try {
            const repo = repoFactory.createRepository<Record<string, unknown>>(repoKey)
            const order = config.sort
              ? Object.fromEntries(Object.entries(config.sort).map(([k, v]) => [k, (v as string).toUpperCase()]))
              : undefined
            return repo.find({
              where: config.filters,
              limit: config.pagination?.limit,
              offset: config.pagination?.offset,
              order: order as Record<string, 'ASC' | 'DESC'>,
            })
          } catch {
            return []
          }
        })

        // Extract searchable fields from DML schema
        try {
          const mod = await doImport(entity.modelPath)
          const dmlEntity = Object.values(mod).find((v: any) => v?.name && v?.schema) as any
          if (dmlEntity?.schema) {
            const searchableFields: string[] = []
            for (const [key, prop] of Object.entries(dmlEntity.schema)) {
              const meta = typeof (prop as any).parse === 'function' ? (prop as any).parse(key) : null
              if (meta?.searchable) searchableFields.push(key)
            }
            if (searchableFields.length > 0) {
              queryService.registerSearchableFields(entityCamel, searchableFields)
            }
          }
        } catch {
          /* schema extraction failed, searchable not available for this entity */
        }
      }
    }

    // Register resolvers for link/pivot tables
    for (const link of [...resources.links, ...resources.modules.flatMap((m: any) => m.intraLinks)]) {
      try {
        const mod = await doImport(link.path)
        // biome-ignore lint/suspicious/noExplicitAny: link def shape varies
        const linkDef = (mod.default ?? mod) as any
        if (linkDef?.tableName) {
          const pivotName = linkDef.tableName.replace(/-/g, '_')
          queryService.registerResolver(pivotName, async (config) => {
            try {
              const repo = repoFactory.createRepository<Record<string, unknown>>(pivotName)
              return repo.find({
                where: config.filters,
                limit: config.pagination?.limit,
                offset: config.pagination?.offset,
              })
            } catch {
              return []
            }
          })
        }
      } catch {
        /* link not importable */
      }
    }

    // Register resolvers for user models
    for (const userDef of userDefinitions) {
      const entityLower = userDef.contextName.toLowerCase()
      const tableName = `${entityLower}s`
      queryService.registerResolver(entityLower, async (config) => {
        try {
          const repo = repoFactory.createRepository<Record<string, unknown>>(tableName)
          const order = config.sort
            ? Object.fromEntries(Object.entries(config.sort).map(([k, v]) => [k, (v as string).toUpperCase()]))
            : undefined
          return repo.find({
            where: config.filters,
            limit: config.pagination?.limit,
            offset: config.pagination?.offset,
            order: order as Record<string, 'ASC' | 'DESC'>,
          })
        } catch {
          return []
        }
      })

      // Extract searchable fields from user model DML schema
      try {
        const dmlModel = userDef.def.model
        if (dmlModel?.schema) {
          const searchableFields: string[] = []
          for (const [key, prop] of Object.entries(dmlModel.schema)) {
            const meta = typeof (prop as any).parse === 'function' ? (prop as any).parse(key) : null
            if (meta?.searchable) searchableFields.push(key)
          }
          if (searchableFields.length > 0) {
            queryService.registerSearchableFields(entityLower, searchableFields)
            logger.info(`  Searchable fields for ${entityLower}: ${searchableFields.join(', ')}`)
          }
        }
      } catch {
        /* schema extraction failed */
      }
    }

    // Wire the query graph extensions discovered from modules/{name}/queries/*.ts
    for (const ext of queryExtensions) {
      queryService.registerExtension(ext)
    }

    builder.registerInfra('queryService', queryService)
    const totalResolvers =
      resources.modules.reduce((n: number, m: any) => n + m.entities.length, 0) + userDefinitions.length
    logger.info(
      `QueryService registered (${totalResolvers} entity resolvers${queryExtensions.length > 0 ? `, ${queryExtensions.length} extension(s)` : ''})`,
    )
  } catch (err) {
    logger.warn(`Failed to create QueryService: ${err instanceof Error ? err.message : String(err)}`)
  }
}
