// Phase 5e: Seed users.
//
// 1. INITIAL USER (prod-safe): if MANTA_ADMIN_EMAIL + MANTA_ADMIN_PASSWORD are set
//    and user doesn't exist in DB, create it via raw SQL. Idempotent.
//    Like Medusa's USER_INITIAL_EMAIL / USER_INITIAL_PASSWORD.
//
// 2. DEV SEED (dev only): seed default contextName@manta.local / admin per context.

import { randomBytes, scryptSync } from 'node:crypto'
import type { AppRef, BootstrapContext } from '../bootstrap-context'

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

/**
 * Seed initial admin user via db.raw() — works with both postgres.js and Neon adapters.
 * Runs when MANTA_ADMIN_EMAIL + MANTA_ADMIN_PASSWORD are set. Idempotent.
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

  try {
    // Check if this email already has an auth identity
    const existing = await db.raw<{ id: string }>(
      'SELECT id FROM provider_identities WHERE entity_id = $1 AND provider = $2 LIMIT 1',
      [email, 'emailpass'],
    )
    if (existing.length > 0) {
      logger.info(`[seed] Initial user already exists — ${email}`)
      return
    }

    // Create auth_identity
    const authRows = await db.raw<{ id: string }>(
      'INSERT INTO auth_identities (app_metadata) VALUES ($1::jsonb) RETURNING id',
      [JSON.stringify({ user_type: 'admin' })],
    )
    const authIdentityId = authRows[0]?.id
    if (!authIdentityId) {
      logger.warn('[seed] Failed to create auth_identity — no id returned')
      return
    }

    // Create provider_identity with hashed password
    const hashedPassword = hashPassword(password)
    await db.raw(
      `INSERT INTO provider_identities (entity_id, provider, auth_identity_id, user_metadata, provider_metadata)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [email, 'emailpass', authIdentityId, JSON.stringify({ email }), JSON.stringify({ password: hashedPassword })],
    )

    // Create admin_user record if table exists
    try {
      const userExists = await db.raw<{ id: string }>('SELECT id FROM admin_user WHERE email = $1 LIMIT 1', [email])
      if (userExists.length === 0) {
        await db.raw('INSERT INTO admin_user (email, first_name, last_name) VALUES ($1, $2, $3)', [
          email,
          'Admin',
          'User',
        ])
      }
    } catch {
      logger.warn('[seed] admin_user table not found — auth identity created, user will appear on next boot')
    }

    logger.info(`[seed] Initial admin user created — ${email}`)
  } catch (err) {
    logger.error(`[seed] Failed to seed initial user: ${err instanceof Error ? err.message : String(err)}`)
  }
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

      // Skip if user already exists
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
  // 1. Initial user (prod-safe, raw SQL, always runs if env vars set)
  await seedInitialUser(ctx)

  // 2. Dev seed (dev only, uses repos/authService)
  await seedDevContextUsers(ctx)
}
