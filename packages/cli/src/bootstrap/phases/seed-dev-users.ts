// Phase 5e: Seed a default user per context.
// In dev mode: always seeds (fallback admin@manta.local / admin).
// In prod mode: seeds only if MANTA_ADMIN_EMAIL is explicitly set (first-deploy flow).

import type { AppRef, BootstrapContext } from '../bootstrap-context'

export async function seedDevUsers(ctx: BootstrapContext, _appRef: AppRef): Promise<void> {
  const hasExplicitAdmin = !!process.env.MANTA_ADMIN_EMAIL
  if (ctx.mode !== 'dev' && !hasExplicitAdmin) return

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

      const seedEmail = process.env.MANTA_ADMIN_EMAIL ?? `${contextName}@manta.local`
      const seedPassword = process.env.MANTA_ADMIN_PASSWORD ?? 'admin'

      // Check if user already exists in the user table
      const existingUsers = await userRepo.find({ where: { email: seedEmail } })
      if (existingUsers.length > 0) {
        logger.info(`[auth:${contextName}] User already exists — ${seedEmail}`)
        continue
      }

      // Register auth identity (also checks for existing provider_identity internally)
      const seedResult = await authService.register('emailpass', {
        url: '',
        headers: {},
        query: {},
        protocol: 'http',
        body: { email: seedEmail, password: seedPassword },
      })
      if (seedResult?.authIdentity) {
        await authService.updateAuthIdentity(seedResult.authIdentity.id, {
          app_metadata: { user_type: contextName },
        })
        await userRepo.create({ email: seedEmail, first_name: 'Dev', last_name: 'Admin' })
        logger.info(`[auth:${contextName}] User seeded — login with: ${seedEmail}`)
      } else {
        logger.info(`[auth:${contextName}] Auth identity already exists — ${seedEmail}`)
      }
    } catch (seedErr) {
      logger.warn(`[auth:${contextName}] Dev seed: ${seedErr instanceof Error ? seedErr.message : String(seedErr)}`)
    }
  }
}
