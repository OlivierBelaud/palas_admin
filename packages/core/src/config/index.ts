// SPEC-010, SPEC-053, SPEC-055 — Config module re-exports

export { BUILT_IN_PRESETS, devPreset, vercelPreset } from './built-in-presets'
export { ConfigManager } from './config-manager'
export { defineConfig } from './define-config'
export { FlagRouter } from './feature-flags'
export type { PresetAdapterEntry, PresetDefinition } from './presets'
export { definePreset } from './presets'
export type {
  AuthConfig,
  BootConfig,
  EnvProfile,
  HttpConfig,
  MantaConfig,
  ModuleConfigEntry,
  ProjectConfig,
  QueryConfig,
  RateLimitConfig,
  SpaConfig,
} from './types'
export {
  AuthConfigSchema,
  AuthSessionConfigSchema,
  BootConfigSchema,
  DatabaseConfigSchema,
  EventsConfigSchema,
  HttpConfigSchema,
  LoadedConfigSchema,
  QueryConfigSchema,
  RateLimitConfigSchema,
  SessionCookieConfigSchema,
  SPA_DEFAULTS,
} from './types'
