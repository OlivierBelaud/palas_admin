// Phase 5e: Seed users.
//
// 1. INITIAL USER (prod-safe): if MANTA_ADMIN_EMAIL + MANTA_ADMIN_PASSWORD are set
//    and user doesn't exist in DB, create it via IDatabasePort.raw().
//    Like Medusa's USER_INITIAL_EMAIL / USER_INITIAL_PASSWORD.
//    No adapter dependency — only uses the IDatabasePort interface.
//
// 2. DEV SEED (dev only): seed default contextName@manta.local / admin per context.

import { randomBytes, scryptSync } from 'node:crypto'
import type { AppRef, BootstrapContext } from '../bootstrap-context'

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function uuid(): string {
  return randomBytes(16)
    .toString('hex')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
}

/**
 * Seed initial admin user via IDatabasePort.raw().
 * No dependency on repos, authService, adapters, or userDefinitions.
 * Only uses the IDatabasePort interface (hexagonal — works with any adapter).
 */
async function seedInitialUser(ctx: BootstrapContext): Promise<void> {
  const email = process.env.MANTA_ADMIN_EMAIL
  const password = process.env.MANTA_ADMIN_PASSWORD
  if (!email || !password) return

  const { logger, db } = ctx
  if (!db) {
    logger.warn('[seed] MANTA_ADMIN_EMAIL set but no database — cannot seed')
    return
  }

  // Step 1: check if provider_identity already exists for this email
  logger.info(`[seed] Checking if ${email} exists...`)
  let existing: { id: string }[]
  try {
    existing = await db.raw<{ id: string }>(
      "SELECT id FROM provider_identities WHERE entity_id = $1 AND provider = 'emailpass' LIMIT 1",
      [email],
    )
  } catch (err) {
    logger.error(`[seed] FATAL — cannot query provider_identities: ${(err as Error).message}`)
    return
  }

  if (existing.length > 0) {
    logger.info(`[seed] User ${email} already exists — skipping`)
    return
  }

  // Step 2: create auth_identity
  const authId = uuid()
  logger.info(`[seed] Creating auth_identity ${authId}...`)
  try {
    await db.raw('INSERT INTO auth_identities (id, app_metadata) VALUES ($1, $2)', [authId, '{"user_type":"admin"}'])
  } catch (err) {
    logger.error(`[seed] FATAL — cannot insert auth_identity: ${(err as Error).message}`)
    return
  }

  // Step 3: create provider_identity with hashed password
  const providerId = uuid()
  const hashedPassword = hashPassword(password)
  const userMeta = JSON.stringify({ email })
  const providerMeta = JSON.stringify({ password: hashedPassword })
  logger.info(`[seed] Creating provider_identity ${providerId}...`)
  try {
    await db.raw(
      `INSERT INTO provider_identities (id, entity_id, provider, auth_identity_id, user_metadata, provider_metadata)
       VALUES ($1, $2, 'emailpass', $3, $4, $5)`,
      [providerId, email, authId, userMeta, providerMeta],
    )
  } catch (err) {
    logger.error(`[seed] FATAL — cannot insert provider_identity: ${(err as Error).message}`)
    return
  }

  // Step 4: create admin_user record
  const userId = uuid()
  logger.info(`[seed] Creating admin_user ${userId}...`)
  try {
    await db.raw('INSERT INTO admin_user (id, email, first_name, last_name) VALUES ($1, $2, $3, $4)', [
      userId,
      email,
      'Admin',
      'User',
    ])
  } catch (err) {
    // Table might not exist yet — that's OK, auth identity is enough for login
    logger.warn(`[seed] admin_user insert failed (table may not exist yet): ${(err as Error).message}`)
  }

  logger.info(`[seed] Initial admin user created — ${email}`)
}

/**
 * Dev-only seed: create default users per context (admin@manta.local / admin, etc.)
 */
async function seedDevContextUsers(ctx: BootstrapContext): Promise<void> {
  if (ctx.mode !== 'dev') return

  const { logger, repoFactory, userDefinitions, authService, generatePgTableFromDml, db } = ctx
  if (!userDefinitions || userDefinitions.length === 0) return

  for (const { contextName, def } of userDefinitions) {
    try {
      const userDmlEntity = def.model
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

      const existingUsers = await userRepo.find({ where: { email: seedEmail } })
      if (existingUsers.length > 0) continue

      const seedResult = await authService.register('emailpass', {
        url: '',
        headers: {},
        query: {},
        protocol: 'http',
        body: { email: seedEmail, password: 'admin' },
      })
      if (seedResult?.authIdentity) {
        await authService.updateAuthIdentity(seedResult.authIdentity.id, {
          app_metadata: { user_type: contextName },
        })
        await userRepo.create({ email: seedEmail, first_name: 'Dev', last_name: 'Admin' })
        logger.info(`[seed:${contextName}] Dev user seeded — ${seedEmail}`)
      }
    } catch (seedErr) {
      logger.warn(`[seed:${contextName}] Dev seed: ${seedErr instanceof Error ? seedErr.message : String(seedErr)}`)
    }
  }
}

export async function seedDevUsers(ctx: BootstrapContext, _appRef: AppRef): Promise<void> {
  await seedInitialUser(ctx)
  await seedDevContextUsers(ctx)
}
