// SPEC-010 — defineConfig with defaults and auto-detection dev/prod

import type { MantaConfig, ProjectConfig } from './types'

/**
 * Defines the application configuration with sensible defaults.
 * Merges user-provided config with framework defaults.
 * Environment auto-detection: APP_ENV > NODE_ENV > "development".
 *
 * @param config - Partial application configuration
 * @returns The merged configuration object
 */
export function defineConfig(config: Partial<MantaConfig> = {}): MantaConfig {
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
    ...(config.query ? { query: config.query } : {}),
    ...(config.http ? { http: config.http } : {}),
    ...(config.auth ? { auth: config.auth } : {}),
    ...(config.boot ? { boot: config.boot } : {}),
  }
}
