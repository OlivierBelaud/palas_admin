// SPEC-070 — manta start command (production)
// Launches the compiled Nitro output. Bootstrap happens inside the catch-all route.

import { loadConfig, validateConfigForCommand } from '../config/load-config'
import { loadEnv } from '../config/load-env'
import type { LoadedConfig, StartOptions } from '../types'

export interface StartCommandResult {
  exitCode: number
  errors: string[]
  warnings: string[]
}

/**
 * manta start — Start the production server.
 * Profile is always 'prod'.
 * No auto-migration. Pending migrations → exit(1).
 * No HMR. JSON logs.
 * Secrets are required (fatal if missing).
 */
export async function startCommand(
  options: StartOptions = {},
  cwd: string = process.cwd(),
): Promise<StartCommandResult> {
  const result: StartCommandResult = { exitCode: 0, errors: [], warnings: [] }

  // [1] Load .env
  const envResult = loadEnv(cwd)
  result.warnings.push(...envResult.warnings)

  // [2] Load config
  let config: LoadedConfig
  try {
    config = await loadConfig(cwd)
  } catch (err) {
    result.exitCode = 1
    result.errors.push(err instanceof Error ? err.message : String(err))
    return result
  }

  // [3] Validate required fields for start
  const validationErrors = validateConfigForCommand(config, 'start')
  if (validationErrors.length > 0) {
    result.exitCode = 1
    result.errors.push(...validationErrors)
    return result
  }

  // [4] Validate secrets (fatal in prod)
  const secretErrors = validateProdSecrets(config)
  if (secretErrors.length > 0) {
    result.exitCode = 1
    result.errors.push(...secretErrors)
    return result
  }

  // [5] Resolve port
  const port = options.port ?? config.http?.port ?? 9000

  // [6] Start production server via @manta/host-nitro
  // Bootstrap happens inside the compiled catch-all route, not here.
  console.log(`\n  Starting Manta production server on port ${port}...`)

  try {
    const { resolve } = await import('node:path')
    const { startProduction } = await import('@manta/host-nitro')
    const outputDir = resolve(cwd, '.output')

    const server = await startProduction({ outputDir, port })

    // Block until process exits
    await new Promise<void>((resolvePromise) => {
      process.on('SIGINT', async () => {
        await server.close()
        resolvePromise()
      })
      process.on('SIGTERM', async () => {
        await server.close()
        resolvePromise()
      })
    })
  } catch (err) {
    result.exitCode = 1
    result.errors.push(err instanceof Error ? err.message : String(err))
  }

  return result
}

function validateProdSecrets(config: LoadedConfig): string[] {
  const errors: string[] = []

  if (!config.auth?.jwtSecret && !process.env['JWT_SECRET']) {
    errors.push('JWT_SECRET is required in production. Set it in .env')
  }

  if (config.auth?.session?.enabled) {
    const cookieSecret = process.env['COOKIE_SECRET']
    if (!cookieSecret) {
      errors.push('COOKIE_SECRET is required when session auth is enabled. Set it in .env')
    }
  }

  return errors
}
