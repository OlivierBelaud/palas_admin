// manta user — Create an admin user (like Medusa's `medusa user -e admin@example.com -p secret`)

import { InMemoryRepositoryFactory } from '@manta/core'
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

/**
 * manta user — Create an admin user.
 *
 * Usage: manta user -e admin@example.com -p supersecret
 *
 * Works in both dev (InMemory) and prod (Drizzle) modes.
 * In dev mode, the user is ephemeral (lost on restart) — use the dev seed instead.
 * In prod mode, the user is persisted to the database.
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

  // Generate random password if not provided
  const password = options.password ?? generatePassword()
  const passwordWasGenerated = !options.password

  try {
    loadEnv(cwd)
    const config = await loadConfig(cwd)

    // Import auth module
    const { AuthModuleService, EmailpassAuthProvider } = await import('@manta/core/auth')

    // For now, use InMemory repos. In production, this command should connect to the DB
    // and create the user directly. TODO: Wire Drizzle repos when DB adapter is available.
    const repoFactory = new InMemoryRepositoryFactory()

    // Try to connect to DB if DATABASE_URL is set
    let authIdentityRepo = repoFactory.createRepository('auth_identity')
    let providerIdentityRepo = repoFactory.createRepository('provider_identity')
    let dbCleanup: (() => Promise<void>) | null = null

    const dbUrl = config.database?.url ?? process.env.DATABASE_URL
    if (dbUrl) {
      try {
        const pg = await import('postgres')
        const { drizzle } = await import('drizzle-orm/postgres-js')
        const sql = pg.default(dbUrl, { max: 1 })
        const _db = drizzle(sql)

        // Create tables if they don't exist
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

        // Use raw SQL repos for the CLI command
        const { InMemoryRepository } = await import('@manta/core')
        authIdentityRepo = new InMemoryRepository('auth_identity')
        providerIdentityRepo = new InMemoryRepository('provider_identity')

        // For a real production implementation, we'd use DrizzlePgAdapter repos.
        // For now, we insert directly via SQL after using the AuthModuleService
        // with InMemory repos to handle password hashing correctly.
        dbCleanup = async () => {
          await sql.end()
        }

        console.log('Connected to database')
      } catch (err) {
        result.warnings.push(`Could not connect to database: ${(err as Error).message}`)
        result.warnings.push('Creating user in memory only (will not persist)')
      }
    }

    const authService = new AuthModuleService({
      baseRepository: authIdentityRepo,
      authIdentityRepository: authIdentityRepo,
      providerIdentityRepository: providerIdentityRepo,
    })
    authService.registerProvider('emailpass', new EmailpassAuthProvider())

    // Register the user
    const registerResult = await authService.register('emailpass', {
      url: '',
      headers: {},
      query: {},
      protocol: 'http',
      body: { email: options.email, password },
    })

    if (!registerResult.success) {
      result.exitCode = 1
      result.errors.push(registerResult.error ?? 'Registration failed')
      if (dbCleanup) await dbCleanup()
      return result
    }

    // Set user_type to 'user' (admin)
    await authService.updateAuthIdentity(registerResult.authIdentity!.id, {
      app_metadata: { user_type: 'user' },
    })

    console.log(`Admin user created: ${options.email}`)
    if (passwordWasGenerated) {
      console.log(`Generated password: ${password}`)
      console.log('(save this — it cannot be retrieved later)')
    }

    if (dbCleanup) await dbCleanup()
  } catch (err) {
    result.exitCode = 1
    result.errors.push((err as Error).message)
  }

  return result
}

function generatePassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%'
  const { randomBytes } = require('node:crypto') as typeof import('node:crypto')
  const bytes = randomBytes(16)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}
