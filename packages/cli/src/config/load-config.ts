// SPEC-070 — Find and import manta.config.ts, map to internal format

import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { MantaError } from '@manta/core'
import type { LoadedConfig } from '../types'

const CONFIG_FILENAMES = ['manta.config.ts', 'manta.config.js', 'manta.config.mjs']

/**
 * Find manta.config.ts by searching from cwd upward until a package.json is found.
 */
export function findConfigFile(cwd: string = process.cwd()): string | null {
  let dir = resolve(cwd)
  const root = resolve('/')

  while (dir !== root) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = resolve(dir, filename)
      if (existsSync(candidate)) {
        return candidate
      }
    }
    // Stop if we found a package.json (project root)
    if (existsSync(resolve(dir, 'package.json'))) {
      return null
    }
    dir = dirname(dir)
  }
  return null
}

/**
 * Load and validate the config file. Maps defineConfig format to LoadedConfig.
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<LoadedConfig> {
  const configPath = findConfigFile(cwd)

  if (!configPath) {
    throw new MantaError(
      'NOT_FOUND',
      'manta.config.ts not found. Run `manta init` to create one.',
    )
  }

  try {
    // Cache bust: add unique query to force re-import when file changes
    const configModule = await import(`${configPath}?t=${Date.now()}_${Math.random()}`)
    const rawConfig = configModule.default ?? configModule

    return mapToLoadedConfig(rawConfig)
  } catch (err) {
    if (MantaError.is(err)) throw err
    const detail = err instanceof Error ? err.message : String(err)
    throw new MantaError(
      'INVALID_DATA',
      `Failed to load manta.config.ts: ${detail}`,
    )
  }
}

/**
 * Validate required fields based on the command being run.
 */
export function validateConfigForCommand(
  config: LoadedConfig,
  command: string,
): string[] {
  const errors: string[] = []

  const requiresDbUrl = ['dev', 'start', 'db:generate', 'db:migrate', 'db:rollback', 'db:diff', 'db:create', 'exec']
  if (requiresDbUrl.includes(command) && !config.database?.url) {
    errors.push('database.url is required. Set DATABASE_URL in .env or database.url in manta.config.ts')
  }

  return errors
}

function mapToLoadedConfig(raw: Record<string, unknown>): LoadedConfig {
  // If it's already in MantaConfig format (from defineConfig), map it
  if (raw.projectConfig) {
    const pc = raw.projectConfig as Record<string, unknown>
    return {
      database: {
        url: (pc.databaseUrl as string) ?? undefined,
      },
      auth: {
        jwtSecret: (pc.jwtSecret as string) ?? undefined,
      },
      modules: (raw.modules as unknown[]) ?? [],
      plugins: (raw.plugins as unknown[]) ?? [],
      featureFlags: (raw.featureFlags as Record<string, boolean>) ?? {},
      strict: (raw.strict as boolean) ?? false,
    }
  }

  // Otherwise assume it's in the new defineConfig DX format
  return raw as LoadedConfig
}
