// @manta/cli — Main entry point
// Parses argv and dispatches to the appropriate command

export { boot } from './bootstrap/boot'
export { type BootstrapOptions, type BootstrappedApp, bootstrapApp } from './bootstrap/bootstrap-app'
export { createProgram } from './cli'
export { buildCommand } from './commands/build'
export { createCommand } from './commands/db/create'
export { diffCommand } from './commands/db/diff'
export { generateCommand } from './commands/db/generate'
export { migrateCommand } from './commands/db/migrate'
export { rollbackCommand } from './commands/db/rollback'
export { devCommand, type MantaRequest } from './commands/dev'
export { execCommand } from './commands/exec'
export { initCommand } from './commands/init'
export { startCommand } from './commands/start'
export { loadConfig } from './config/load-config'
export { loadEnv } from './config/load-env'
export { resolveAdapters } from './config/resolve-adapters'

export type {
  BuildOptions,
  DevOptions,
  DiffOptions,
  ExecOptions,
  GenerateOptions,
  InitOptions,
  MigrateOptions,
  RollbackOptions,
  StartOptions,
} from './types'
