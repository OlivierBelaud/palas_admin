// [13c] User routes — auth routes + middleware registration per user context.
// Dev user seeding moved to the dedicated seed-dev-users phase.

import { generateAllUserRoutes, getPublicPaths } from '@manta/core'
import type { ICachePort } from '@manta/core/ports'
import type { AppRef, BootstrapContext } from '../../../bootstrap-context'
import { ensureEntityTables } from '../../../bootstrap-helpers'

export async function userRoutes(ctx: BootstrapContext, _appRef: AppRef): Promise<void> {
  const {
    logger,
    db,
    infraMap,
    repoFactory,
    resources,
    doImport,
    generatedTables,
    userDefinitions,
    generatePgTableFromDml,
    adapter,
    authService,
    jwtSecret,
  } = ctx

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
      } catch (err) {
        logger.warn(
          `Failed to wire user routes for '${contextName}': ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }
}
