// SPEC-055 — Feature flags with 3-level priority

/**
 * FlagRouter resolves feature flags with a 3-level priority:
 * 1. Environment variables: MANTA_FF_<FLAG_NAME> (highest priority)
 * 2. Config file flags (from defineConfig({ featureFlags: { ... } }))
 * 3. Default values registered via setDefault() (lowest priority)
 *
 * Flag names are case-insensitive for env var lookup.
 */
export class FlagRouter {
  private readonly configFlags: Record<string, boolean>
  private readonly defaults: Map<string, boolean> = new Map()

  /**
   * Create a FlagRouter with config-level flags.
   *
   * @param configFlags - Flags from defineConfig({ featureFlags })
   */
  constructor(configFlags: Record<string, boolean> = {}) {
    this.configFlags = { ...configFlags }
  }

  /**
   * Check if a feature flag is enabled.
   * Priority: env MANTA_FF_* > config > defaults.
   *
   * @param flagName - The flag name (e.g. "workflows_v2", "analytics")
   * @returns True if the flag is enabled, false otherwise
   */
  isEnabled(flagName: string): boolean {
    // Level 1: Check env var (MANTA_FF_<UPPERCASE_FLAG>)
    const envKey = `MANTA_FF_${flagName.toUpperCase()}`
    const envValue = process.env[envKey]
    if (envValue !== undefined) {
      return envValue === 'true' || envValue === '1'
    }

    // Level 2: Check config flags
    if (flagName in this.configFlags) {
      return this.configFlags[flagName]!
    }

    // Level 3: Check defaults
    const defaultValue = this.defaults.get(flagName)
    if (defaultValue !== undefined) {
      return defaultValue
    }

    // Not found anywhere → disabled
    return false
  }

  /**
   * Set a flag value at the config level (overrides defaults, overridden by env).
   *
   * @param flagName - The flag name
   * @param value - Whether the flag is enabled
   */
  setFlag(flagName: string, value: boolean): void {
    this.configFlags[flagName] = value
  }

  /**
   * Register a default value for a flag (lowest priority).
   *
   * @param flagName - The flag name
   * @param value - The default value
   */
  setDefault(flagName: string, value: boolean): void {
    this.defaults.set(flagName, value)
  }

  /**
   * List all known flags with their resolved values.
   * Includes flags from env, config, and defaults.
   *
   * @returns Record of flag names to their resolved boolean values
   */
  listFlags(): Record<string, boolean> {
    const result: Record<string, boolean> = {}

    // Collect all known flag names
    const allNames = new Set<string>()

    // From defaults
    for (const name of this.defaults.keys()) {
      allNames.add(name)
    }

    // From config
    for (const name of Object.keys(this.configFlags)) {
      allNames.add(name)
    }

    // From env vars
    for (const envKey of Object.keys(process.env)) {
      if (envKey.startsWith('MANTA_FF_')) {
        const flagName = envKey.slice('MANTA_FF_'.length).toLowerCase()
        allNames.add(flagName)
      }
    }

    // Resolve each
    for (const name of allNames) {
      result[name] = this.isEnabled(name)
    }

    return result
  }
}
