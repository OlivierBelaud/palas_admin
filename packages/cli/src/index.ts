// @manta/cli — Main entry point
// Parses argv and dispatches to the appropriate command

export { createProgram } from './cli'
export { loadEnv } from './config/load-env'
export { loadConfig } from './config/load-config'
export { resolveAdapters } from './config/resolve-adapters'
export { devCommand, type MantaRequest } from './commands/dev'
export { startCommand } from './commands/start'
export { buildCommand } from './commands/build'
export { initCommand } from './commands/init'
export { execCommand } from './commands/exec'
export { generateCommand } from './commands/db/generate'
export { migrateCommand } from './commands/db/migrate'
export { rollbackCommand } from './commands/db/rollback'
export { diffCommand } from './commands/db/diff'
export { createCommand } from './commands/db/create'
export { boot } from './bootstrap/boot'

export type {
  DevOptions,
  StartOptions,
  BuildOptions,
  InitOptions,
  ExecOptions,
  GenerateOptions,
  MigrateOptions,
  RollbackOptions,
  DiffOptions,
} from './types'
