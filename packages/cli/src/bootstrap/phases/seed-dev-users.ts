// Phase 5e (dev-only): Seed a default user per context so developers can log in
// immediately without going through the register flow. Extracted from user-routes
// so the wiring phase only wires routes and this data-population concern lives on
// its own and is skipped in prod.

import type { AppRef, BootstrapContext } from '../bootstrap-context'

export async function seedDevUsers(ctx: BootstrapContext, _appRef: AppRef): Promise<void> {
  if (ctx.mode !== 'dev') return

  const { logger, repoFactory, userDefinitions, authService, generatePgTableFromDml, db } = ctx

  if (!userDefinitions || userDefinitions.length === 0) return

  for (const { contextName, def } of userDefinitions) {
    try {
      const userDmlEntity = def.model
      // Resolve the repository key the same way user-routes did — prefer the generated
      // table name (via generatePgTableFromDml) so the seed writes to the same table
      // that the wiring phase registered.
      let userRepoKey: string = userDmlEntity?.name?.toLowerCase() ?? contextName
      if (db && userDmlEntity) {
        const userTable = generatePgTableFromDml(
          userDmlEntity as unknown as Parameters<typeof generatePgTableFromDml>[0],
        )
        userRepoKey = userTable.tableName
      }
      // biome-ignore lint/suspicious/noExplicitAny: repo type varies between DrizzleRepository and InMemoryRepository
      const userRepo: any = repoFactory.createRepository(userRepoKey)

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
      logger.warn(`[auth:${contextName}] Dev seed: ${seedErr instanceof Error ? seedErr.message : String(seedErr)}`)
    }
  }
}
