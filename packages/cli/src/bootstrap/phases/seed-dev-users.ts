// Phase 5e: Seed initial admin user.
//
// If MANTA_ADMIN_EMAIL + MANTA_ADMIN_PASSWORD are set, create the user
// in auth_identities, provider_identities, AND the admin user table.
// Idempotent: fills any missing table while skipping what already exists.
// Like Medusa's USER_INITIAL_EMAIL / USER_INITIAL_PASSWORD.

import { randomBytes, scryptSync } from 'node:crypto'
import type { AppRef, BootstrapContext } from '../bootstrap-context'
import { entityToTableKey } from '../bootstrap-helpers'

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

  const { logger, db, userDefinitions } = ctx
  if (!db) {
    logger.warn('[seed] MANTA_ADMIN_EMAIL set but no database — cannot seed')
    return
  }

  // Resolve the admin user table name from the first userDefinition (e.g. 'Admin' → 'admins')
  const adminDef = userDefinitions?.find((u) => u.contextName === 'admin')
  const adminTableName = adminDef?.def?.model?.name ? entityToTableKey(adminDef.def.model.name) : 'admins'

  logger.info(`[seed] Initial user: ${email} (table: ${adminTableName})`)

  // --- 1. provider_identities ---
  let hasAuth = false
  try {
    const rows = await db.raw<{ id: string }>(
      "SELECT id FROM provider_identities WHERE entity_id = $1 AND provider = 'emailpass' LIMIT 1",
      [email],
    )
    if (rows.length > 0) {
      hasAuth = true
      logger.info('[seed] provider_identity exists — OK')
    }
  } catch (err) {
    logger.error(`[seed] Cannot query provider_identities: ${(err as Error).message}`)
    return
  }

  if (!hasAuth) {
    const authIdentityId = uuid()
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

  // --- 2. User table — ALWAYS ensure the row exists ---
  try {
    const userRows = await db.raw<{ id: string }>(`SELECT id FROM ${adminTableName} WHERE email = $1 LIMIT 1`, [email])
    if (userRows.length > 0) {
      logger.info(`[seed] ${adminTableName} row exists — OK`)
    } else {
      const userId = uuid()
      await db.raw(`INSERT INTO ${adminTableName} (id, email, first_name, last_name) VALUES ($1, $2, $3, $4)`, [
        userId,
        email,
        'Admin',
        'User',
      ])
      logger.info(`[seed] ${adminTableName} row created: ${userId}`)
    }
  } catch (err) {
    logger.error(`[seed] Cannot create ${adminTableName} row: ${(err as Error).message}`)
  }

  logger.info(`[seed] Done — login with ${email}`)
}
