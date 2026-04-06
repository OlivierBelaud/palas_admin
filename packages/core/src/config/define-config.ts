// SPEC-010 — defineConfig with defaults and auto-detection dev/prod

import { MantaError } from '../errors/manta-error'
import type { MantaConfig, ProjectConfig } from './types'
import { AuthConfigSchema, HttpConfigSchema, QueryConfigSchema } from './types'

/**
 * Defines the application configuration with sensible defaults.
 * Validates config sections via Zod schemas at definition time — errors are
 * caught early, not at boot.
 *
 * @example
 * ```typescript
 * // manta.config.ts
 * import { defineConfig } from '@manta/core'
 *
 * export default defineConfig({
 *   database: { url: process.env.DATABASE_URL },
 *   http: { port: 3000 },
 *   admin: { enabled: true },
 * })
 * ```
 */
export function defineConfig(config: Partial<MantaConfig> = {}): MantaConfig {
  // Validate known config sections early
  if (config.http) {
    const result = HttpConfigSchema.safeParse(config.http)
    if (!result.success) {
      const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
      throw new MantaError('INVALID_DATA', `Invalid http config:\n${issues}`)
    }
  }
  if (config.auth) {
    const result = AuthConfigSchema.safeParse(config.auth)
    if (!result.success) {
      const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
      throw new MantaError('INVALID_DATA', `Invalid auth config:\n${issues}`)
    }
  }
  if (config.query) {
    const result = QueryConfigSchema.safeParse(config.query)
    if (!result.success) {
      const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
      throw new MantaError('INVALID_DATA', `Invalid query config:\n${issues}`)
    }
  }

  const projectConfig: ProjectConfig = {
    ...(config.projectConfig ?? {}),
  }

  return {
    projectConfig,
    admin: config.admin ?? {},
    modules: config.modules ?? {},
    plugins: config.plugins ?? [],
    featureFlags: config.featureFlags ?? {},
    strict: config.strict ?? false,
    ...(config.database ? { database: config.database } : {}),
    ...(config.preset ? { preset: config.preset } : {}),
    ...(config.adapters ? { adapters: config.adapters } : {}),
    ...(config.query ? { query: config.query } : {}),
    ...(config.http ? { http: config.http } : {}),
    ...(config.auth ? { auth: config.auth } : {}),
    ...(config.boot ? { boot: config.boot } : {}),
    ...(config.spa ? { spa: config.spa } : {}),
  }
}
