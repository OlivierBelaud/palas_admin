// manta user — Create an admin user (like Medusa's `medusa user -e admin@example.com -p secret`)
// Writes directly to the database via SQL. No bootstrap needed.

import { randomBytes, scryptSync } from 'node:crypto'
import { loadConfig } from '../config/load-config'
import { loadEnv } from '../config/load-env'

export interface UserCommandOptions {
  email: string
  password?: string
}

export interface UserCommandResult {
  exitCode: number
  errors: string[]
  warnings: string[]
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function generatePassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%'
  const bytes = randomBytes(16)
  return Array.from(bytes, (b: number) => chars[b % chars.length]).join('')
}

/**
 * manta user — Create an admin user.
 *
 * Usage: manta user -e admin@example.com -p supersecret
 *
 * Connects directly to the database and inserts auth_identity + provider_identity + admin_user.
 * Like Medusa's `medusa user` command — no bootstrap, no InMemory, just SQL.
 */
export async function userCommand(
  options: UserCommandOptions,
  cwd: string = process.cwd(),
): Promise<UserCommandResult> {
  const result: UserCommandResult = { exitCode: 0, errors: [], warnings: [] }

  if (!options.email) {
    result.exitCode = 1
    result.errors.push('Email is required. Usage: manta user -e admin@example.com -p supersecret')
    return result
  }

  const password = options.password ?? generatePassword()
  const passwordWasGenerated = !options.password

  try {
    loadEnv(cwd)
    const config = await loadConfig(cwd)
    const dbUrl = config.database?.url ?? process.env.DATABASE_URL

    if (!dbUrl) {
      result.exitCode = 1
      result.errors.push('DATABASE_URL is required. Set it in .env or manta.config.ts')
      return result
    }

    const pg = await import('postgres')
    const sql = pg.default(dbUrl, { max: 1 })

    try {
      // Ensure auth tables exist
      await sql`CREATE TABLE IF NOT EXISTS auth_identities (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
        app_metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )`
      await sql`CREATE TABLE IF NOT EXISTS provider_identities (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        auth_identity_id TEXT NOT NULL REFERENCES auth_identities(id),
        user_metadata JSONB DEFAULT '{}',
        provider_metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )`

      // Check if identity already exists
      const existing = await sql`
        SELECT id FROM provider_identities
        WHERE entity_id = ${options.email} AND provider = 'emailpass'
      `
      if (existing.length > 0) {
        result.exitCode = 1
        result.errors.push(`User ${options.email} already exists. Delete it first to reset the password.`)
        await sql.end()
        return result
      }

      // Hash password and insert
      const hashedPassword = hashPassword(password)

      const [authIdentity] = await sql`
        INSERT INTO auth_identities (app_metadata)
        VALUES (${JSON.stringify({ user_type: 'admin' })})
        RETURNING id
      `

      await sql`
        INSERT INTO provider_identities (entity_id, provider, auth_identity_id, user_metadata, provider_metadata)
        VALUES (
          ${options.email},
          'emailpass',
          ${authIdentity.id},
          ${JSON.stringify({ email: options.email })},
          ${JSON.stringify({ password: hashedPassword })}
        )
      `

      // Create admin_user record if table exists
      try {
        const userExists = await sql`
          SELECT id FROM admin_user WHERE email = ${options.email}
        `
        if (userExists.length === 0) {
          await sql`
            INSERT INTO admin_user (email, first_name, last_name)
            VALUES (${options.email}, 'Admin', 'User')
          `
        }
      } catch {
        // admin_user table may not exist yet (first deploy) — that's OK,
        // the bootstrap will create it. The auth identity is what matters for login.
        result.warnings.push(
          'admin_user table not found — auth identity created, user record will be created on first boot',
        )
      }

      console.log(`Admin user created: ${options.email}`)
      if (passwordWasGenerated) {
        console.log(`Generated password: ${password}`)
        console.log('(save this — it cannot be retrieved later)')
      }

      await sql.end()
    } catch (err) {
      await sql.end()
      throw err
    }
  } catch (err) {
    result.exitCode = 1
    result.errors.push((err as Error).message)
  }

  return result
}
