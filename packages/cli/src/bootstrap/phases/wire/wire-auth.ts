// Phase 5a: Auth wiring — AuthModuleService, EmailpassAuthProvider, JWT secret.

import { MantaError } from '@manta/core'
import { AuthIdentity, AuthModuleService, EmailpassAuthProvider, ProviderIdentity } from '@manta/core/auth'
import type { ICachePort } from '@manta/core/ports'
import type { AppRef, BootstrapContext } from '../../bootstrap-context'
import { ensureEntityTables } from '../../bootstrap-helpers'

export async function wireAuth(ctx: BootstrapContext, _appRef: AppRef): Promise<void> {
  const { logger, db, infraMap, repoFactory, mode, generatedTables, generatePgTableFromDml } = ctx

  // [12b] Wire AuthModuleService + auth verifier
  // biome-ignore lint/suspicious/noExplicitAny: repos assigned from different adapter paths
  let authIdentityRepo: any
  // biome-ignore lint/suspicious/noExplicitAny: repos assigned from different adapter paths
  let providerIdentityRepo: any
  let authIdentityTableName = 'auth_identity'
  let providerIdentityTableName = 'provider_identity'
  if (db) {
    const aiTable = generatePgTableFromDml(AuthIdentity)
    const piTable = generatePgTableFromDml(ProviderIdentity)
    authIdentityTableName = aiTable.tableName
    providerIdentityTableName = piTable.tableName
    generatedTables.set(aiTable.tableName, aiTable.table)
    generatedTables.set(piTable.tableName, piTable.table)
    repoFactory.registerTable!(aiTable.tableName, aiTable.table)
    repoFactory.registerTable!(piTable.tableName, piTable.table)
    await ensureEntityTables(
      db.getPool(),
      [
        { name: AuthIdentity.name, schema: (AuthIdentity as any).schema },
        { name: ProviderIdentity.name, schema: (ProviderIdentity as any).schema },
      ],
      [],
      logger,
    )
    logger.info('[auth] Auth tables generated (Drizzle — persisted)')
  }
  authIdentityRepo = repoFactory.createRepository(authIdentityTableName)
  providerIdentityRepo = repoFactory.createRepository(providerIdentityTableName)

  const authService = new AuthModuleService({
    baseRepository: authIdentityRepo,
    authIdentityRepository: authIdentityRepo,
    providerIdentityRepository: providerIdentityRepo,
    cache: infraMap.get('ICachePort') as ICachePort,
  })
  authService.registerProvider('emailpass', new EmailpassAuthProvider())
  ctx.authService = authService

  // JWT secret: required in prod, fallback in dev
  if (mode === 'prod' && !process.env.JWT_SECRET) {
    throw new MantaError(
      'INVALID_STATE',
      '[auth] JWT_SECRET environment variable is required in production. Set it before deploying.',
    )
  }
  const jwtSecret = process.env.JWT_SECRET ?? 'manta-dev-secret'
  ctx.jwtSecret = jwtSecret
}
