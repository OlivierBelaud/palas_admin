// SPEC-070 — Find and import manta.config.ts, map to internal format

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { LoadedConfigSchema, MantaError } from '@manta/core'
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
export interface LoadConfigOptions {
  /**
   * Custom importer for `manta.config.ts`. When provided, loadConfig uses it instead
   * of Node's native `import()`. Required in bundler-hostile environments (Next.js,
   * Vite SSR) where runtime TS loading needs jiti/tsx. The importer must accept an
   * absolute filesystem path and return the module's exports.
   */
  importFn?: (path: string) => Promise<Record<string, unknown>>
}

export async function loadConfig(cwd: string = process.cwd(), opts: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const configPath = findConfigFile(cwd)

  if (!configPath) {
    throw new MantaError('NOT_FOUND', 'manta.config.ts not found. Run `manta init` to create one.')
  }

  try {
    let configModule: Record<string, unknown>
    if (opts.importFn) {
      // Caller-supplied importer (e.g. jiti from @manta/adapter-nextjs).
      // Skips the cache-bust query string because jiti has its own invalidation.
      configModule = await opts.importFn(configPath)
    } else {
      // Native dynamic import path (CLI dev mode — relies on tsx loader in the process).
      // Cache bust: add unique query to force re-import when file changes.
      configModule = await import(`${configPath}?t=${Date.now()}_${Math.random()}`)
    }
    const rawConfig = configModule.default ?? configModule

    return mapToLoadedConfig(rawConfig as Record<string, unknown>)
  } catch (err) {
    if (MantaError.is(err)) throw err
    const detail = err instanceof Error ? err.message : String(err)
    throw new MantaError('INVALID_DATA', `Failed to load manta.config.ts: ${detail}`)
  }
}

/**
 * Validate required fields based on the command being run.
 */
export function validateConfigForCommand(config: LoadedConfig, command: string): string[] {
  const errors: string[] = []

  const requiresDbUrl = ['dev', 'start', 'db:generate', 'db:migrate', 'db:rollback', 'db:diff', 'db:create', 'exec']
  if (requiresDbUrl.includes(command) && !config.database?.url) {
    errors.push('database.url is required. Set DATABASE_URL in .env or database.url in manta.config.ts')
  }

  return errors
}

function mapToLoadedConfig(raw: Record<string, unknown>): LoadedConfig {
  let mapped: Record<string, unknown>

  // If it's already in MantaConfig format (from defineConfig), map it
  if (raw.projectConfig) {
    const pc = raw.projectConfig as Record<string, unknown>
    const rawDb = raw.database as Record<string, unknown> | undefined
    mapped = {
      database: rawDb?.url ? rawDb : { url: (pc.databaseUrl as string) ?? undefined },
      auth: {
        jwtSecret: (pc.jwtSecret as string) ?? undefined,
      },
      modules: Array.isArray(raw.modules) ? raw.modules : [],
      plugins: Array.isArray(raw.plugins) ? raw.plugins : [],
      featureFlags: (raw.featureFlags as Record<string, boolean>) ?? {},
      strict: (raw.strict as boolean) ?? false,
      ...(raw.http ? { http: raw.http } : {}),
      ...(raw.query ? { query: raw.query } : {}),
      ...(raw.boot ? { boot: raw.boot } : {}),
      ...(raw.adapters ? { adapters: raw.adapters } : {}),
      ...(raw.preset ? { preset: raw.preset } : {}),
    }
  } else {
    // Otherwise assume it's in the new defineConfig DX format
    mapped = { ...raw }
    // Normalize modules: defineConfig returns Record, schema expects array (or undefined)
    if (mapped.modules && !Array.isArray(mapped.modules)) {
      mapped.modules =
        Object.keys(mapped.modules).length === 0
          ? undefined
          : Object.entries(mapped.modules).map(([k, v]) => ({ resolve: k, ...(typeof v === 'object' ? v : {}) }))
    }
  }

  const result = LoadedConfigSchema.safeParse(mapped)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    throw new MantaError('INVALID_DATA', `Invalid configuration: ${issues}`)
  }
  return result.data as LoadedConfig
}
