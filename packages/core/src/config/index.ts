// SPEC-010, SPEC-053, SPEC-055 — Config module re-exports

export { defineConfig } from './define-config'
export { ConfigManager } from './config-manager'
export { FlagRouter } from './feature-flags'
export type {
  MantaConfig,
  ProjectConfig,
  EnvProfile,
  ModuleConfigEntry,
  QueryConfig,
  HttpConfig,
  BootConfig,
  AuthConfig,
  RateLimitConfig,
} from './types'
