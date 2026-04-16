// Phase 5e: Seed initial admin user.
//
// If MANTA_ADMIN_EMAIL + MANTA_ADMIN_PASSWORD are set, create the user
// in auth_identities, provider_identities, AND admin_user tables.
// Idempotent: fills any missing table while skipping what already exists.
// Like Medusa's USER_INITIAL_EMAIL / USER_INITIAL_PASSWORD.

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

export async function seedDevUsers(ctx: BootstrapContext, _appRef: AppRef): Promise<void> {
  const email = process.env.MANTA_ADMIN_EMAIL
  const password = process.env.MANTA_ADMIN_PASSWORD
  if (!email || !password) return

  const { logger, db } = ctx
  if (!db) {
    logger.warn('[seed] MANTA_ADMIN_EMAIL set but no database — cannot seed')
    return
  }

  logger.info(`[seed] Initial user: ${email}`)

  // --- 1. provider_identities ---
  let hasAuth = false
  let authIdentityId: string | null = null
  try {
    const rows = await db.raw<{ id: string; auth_identity_id: string }>(
      "SELECT id, auth_identity_id FROM provider_identities WHERE entity_id = $1 AND provider = 'emailpass' LIMIT 1",
      [email],
    )
    if (rows.length > 0) {
      hasAuth = true
      authIdentityId = rows[0].auth_identity_id
      logger.info('[seed] provider_identity exists — OK')
    }
  } catch (err) {
    logger.error(`[seed] Cannot query provider_identities: ${(err as Error).message}`)
    return
  }

  if (!hasAuth) {
    // Create auth_identity
    authIdentityId = uuid()
    try {
      await db.raw('INSERT INTO auth_identities (id, app_metadata) VALUES ($1, $2)', [
        authIdentityId,
        '{"user_type":"admin"}',
      ])
      logger.info(`[seed] auth_identity created: ${authIdentityId}`)
    } catch (err) {
      logger.error(`[seed] Cannot insert auth_identity: ${(err as Error).message}`)
      return
    }

    // Create provider_identity
    const providerId = uuid()
    const hashedPassword = hashPassword(password)
    try {
      await db.raw(
        `INSERT INTO provider_identities (id, entity_id, provider, auth_identity_id, user_metadata, provider_metadata)
         VALUES ($1, $2, 'emailpass', $3, $4, $5)`,
        [providerId, email, authIdentityId, JSON.stringify({ email }), JSON.stringify({ password: hashedPassword })],
      )
      logger.info(`[seed] provider_identity created: ${providerId}`)
    } catch (err) {
      logger.error(`[seed] Cannot insert provider_identity: ${(err as Error).message}`)
      return
    }
  }

  // --- 2. admin_user — ALWAYS ensure it exists ---
  try {
    const userRows = await db.raw<{ id: string }>('SELECT id FROM admin_user WHERE email = $1 LIMIT 1', [email])
    if (userRows.length > 0) {
      logger.info('[seed] admin_user exists — OK')
    } else {
      const userId = uuid()
      await db.raw('INSERT INTO admin_user (id, email, first_name, last_name) VALUES ($1, $2, $3, $4)', [
        userId,
        email,
        'Admin',
        'User',
      ])
      logger.info(`[seed] admin_user created: ${userId}`)
    }
  } catch (err) {
    logger.error(`[seed] Cannot create admin_user: ${(err as Error).message}`)
  }

  logger.info(`[seed] Done — login with ${email}`)
}
