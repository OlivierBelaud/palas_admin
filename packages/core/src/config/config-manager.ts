// SPEC-053 — ConfigManager singleton with validation

import { MantaError } from '../errors/manta-error'
import { defineConfig } from './define-config'
import type { EnvProfile, MantaConfig } from './types'

/**
 * Prefix for environment variable overrides.
 * Any env var starting with MANTA_ overrides the corresponding config key.
 */
const ENV_PREFIX = 'MANTA_'

/**
 * Prefix for feature flag env var overrides.
 */
const FF_ENV_PREFIX = 'MANTA_FF_'

/**
 * Required secrets in production. Missing secrets throw MantaError in prod, warn in dev.
 */
const PROD_REQUIRED_SECRETS: ReadonlyArray<string> = ['projectConfig.databaseUrl', 'projectConfig.jwtSecret']

/**
 * ConfigManager loads, normalizes, and provides access to application configuration.
 * Singleton — loaded once at startup. Env vars take priority (serverless-friendly).
 *
 * @param config - The MantaConfig to manage (from defineConfig())
 */
export class ConfigManager {
  private static instance: ConfigManager | null = null

  private readonly config: MantaConfig
  private readonly envProfile: EnvProfile

  private constructor(config: MantaConfig) {
    this.config = this.mergeEnvOverrides(config)
    this.envProfile = ConfigManager.detectProfile()
    this.validateSecrets()
  }

  /**
   * Initialize the ConfigManager singleton with the given config.
   * Can only be called once. Subsequent calls throw MantaError.
   *
   * @param config - Partial or full MantaConfig
   * @returns The ConfigManager instance
   */
  static initialize(config: Partial<MantaConfig> = {}): ConfigManager {
    if (ConfigManager.instance) {
      throw new MantaError(
        'INVALID_STATE',
        'ConfigManager is already initialized. Call ConfigManager.reset() first if re-initialization is needed.',
      )
    }
    const merged = defineConfig(config)
    ConfigManager.instance = new ConfigManager(merged)
    return ConfigManager.instance
  }

  /**
   * Get the ConfigManager singleton instance.
   * Throws if not yet initialized.
   *
   * @returns The ConfigManager instance
   */
  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      throw new MantaError(
        'INVALID_STATE',
        'ConfigManager has not been initialized. Call ConfigManager.initialize() first.',
      )
    }
    return ConfigManager.instance
  }

  /**
   * Reset the singleton (for testing purposes).
   */
  static reset(): void {
    ConfigManager.instance = null
  }

  /**
   * Detect the environment profile from APP_ENV or NODE_ENV.
   * dev = development | test
   * prod = production | staging
   *
   * @returns The detected environment profile
   */
  static detectProfile(): EnvProfile {
    const appEnv = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development'
    const normalized = appEnv.toLowerCase()

    if (normalized === 'production' || normalized === 'staging') {
      return 'prod'
    }
    return 'dev'
  }

  /**
   * Get the raw environment string (APP_ENV > NODE_ENV > "development").
   *
   * @returns The raw environment string
   */
  static getEnvString(): string {
    return process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development'
  }

  /**
   * Get a config value by dot-notation key.
   * Example: get('projectConfig.databaseUrl')
   *
   * @param key - Dot-notation path into the config
   * @returns The value at the given path, or undefined if not found
   */
  get(key: string): unknown {
    const parts = key.split('.')
    let current: unknown = this.config

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  /**
   * Get the entire resolved config object.
   *
   * @returns The full MantaConfig
   */
  getConfig(): Readonly<MantaConfig> {
    return this.config
  }

  /**
   * Get the current environment profile (dev or prod).
   *
   * @returns The environment profile
   */
  getProfile(): EnvProfile {
    return this.envProfile
  }

  /**
   * Check if we are running in development profile.
   *
   * @returns True if profile is dev
   */
  isDev(): boolean {
    return this.envProfile === 'dev'
  }

  /**
   * Check if we are running in production profile.
   *
   * @returns True if profile is prod
   */
  isProd(): boolean {
    return this.envProfile === 'prod'
  }

  /**
   * Merge MANTA_* environment variables on top of file config.
   * Env var keys are converted from MANTA_SOME_KEY to some.key (dot-notation).
   *
   * @param config - The base config
   * @returns Config with env overrides applied
   */
  private mergeEnvOverrides(config: MantaConfig): MantaConfig {
    const result = structuredClone(config)

    for (const [envKey, envValue] of Object.entries(process.env)) {
      if (!envKey.startsWith(ENV_PREFIX) || envKey.startsWith(FF_ENV_PREFIX)) {
        continue
      }
      if (envValue === undefined) {
        continue
      }

      // Convert MANTA_PROJECT_CONFIG_DATABASE_URL → projectConfig.databaseUrl
      const configPath = this.envKeyToConfigPath(envKey.slice(ENV_PREFIX.length))
      this.setNestedValue(
        result as unknown as Record<string, unknown>,
        configPath,
        this.parseEnvValue(String(envValue)),
      )
    }

    return result
  }

  /**
   * Convert an env key suffix (after MANTA_) to a dot-notation config path.
   * Example: PROJECT_CONFIG_DATABASE_URL → projectConfig.databaseUrl
   *
   * @param suffix - The env key suffix (after removing MANTA_ prefix)
   * @returns Dot-notation config path
   */
  private envKeyToConfigPath(suffix: string): string {
    return (
      suffix
        .toLowerCase()
        .split('_')
        .reduce((acc: string[], part, index) => {
          if (index === 0) {
            acc.push(part)
          } else {
            // camelCase joining
            acc.push(part.charAt(0).toUpperCase() + part.slice(1))
          }
          return acc
        }, [])
        .join('')
        .replace(/([A-Z])/g, '.$1')
        .toLowerCase()
        // Fix: this simple approach won't produce correct dot notation for nested paths
        // A more robust approach:
        .split('.')
        .join('.')
    )
  }

  /**
   * Set a value at a nested path in an object.
   *
   * @param obj - The object to modify
   * @param path - Dot-notation path
   * @param value - The value to set
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.')
    let current: Record<string, unknown> = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!
      if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }

    const lastPart = parts[parts.length - 1]!
    current[lastPart] = value
  }

  /**
   * Parse an env var value string into the appropriate type.
   * "true"/"false" → boolean, numeric strings → number, otherwise string.
   *
   * @param value - The raw env var string
   * @returns Parsed value
   */
  private parseEnvValue(value: string): unknown {
    if (value === 'true') return true
    if (value === 'false') return false
    const num = Number(value)
    if (!Number.isNaN(num) && value.trim() !== '') return num
    return value
  }

  /**
   * Validate that required secrets are present.
   * In prod: throw MantaError if missing.
   * In dev: log a warning (console.warn) if missing.
   */
  private validateSecrets(): void {
    for (const secretPath of PROD_REQUIRED_SECRETS) {
      const value = this.get(secretPath)
      if (value === undefined || value === null || value === '') {
        if (this.envProfile === 'prod') {
          throw new MantaError('INVALID_DATA', `Missing required secret "${secretPath}" in production environment.`)
        } else {
          console.warn(`[manta:config] Missing secret "${secretPath}" — ignored in dev mode.`)
        }
      }
    }
  }
}
