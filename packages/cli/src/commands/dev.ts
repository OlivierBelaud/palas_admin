// SPEC-070 — manta dev command
// Bootstraps the app with real adapters and starts the dev server

import type { DevOptions, LoadedConfig } from '../types'
import { loadEnv } from '../config/load-env'
import { loadConfig, validateConfigForCommand } from '../config/load-config'
import { bootstrapAndStart } from '../server-bootstrap'

export type { MantaRequest } from '../server-bootstrap'

export interface DevCommandResult {
  exitCode: number
  errors: string[]
  warnings: string[]
}

/**
 * manta dev — Start the development server.
 * Profile is always 'dev'.
 * Pretty logs, auto-migration, HMR (future).
 */
export async function devCommand(
  options: DevOptions = {},
  cwd: string = process.cwd(),
): Promise<DevCommandResult> {
  const result: DevCommandResult = { exitCode: 0, errors: [], warnings: [] }

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

  // [3] Validate required fields for dev
  const validationErrors = validateConfigForCommand(config, 'dev')
  if (validationErrors.length > 0) {
    result.exitCode = 1
    result.errors.push(...validationErrors)
    return result
  }

  // [4] Resolve port
  const port = options.port ?? config.http?.port ?? 9000

  // [5] Bootstrap and start (never returns — blocks on HTTP server)
  try {
    await bootstrapAndStart({
      config,
      port,
      cwd,
      mode: 'dev',
      verbose: options.verbose,
    })
  } catch (err) {
    result.exitCode = 1
    result.errors.push(err instanceof Error ? err.message : String(err))
  }

  return result
}
