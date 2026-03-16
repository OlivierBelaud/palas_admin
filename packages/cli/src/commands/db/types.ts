// Common dependency interfaces for DB commands
// These allow port injection for testability (hexagonal architecture)

/**
 * Minimal DB operations needed by CLI commands.
 * This is NOT IDatabasePort — it's a focused subset for the CLI.
 */
export interface DbClient {
  /** Execute raw SQL */
  execute(sql: string): Promise<void>
  /** Execute SQL and return rows */
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>
  /** Run a function inside a transaction */
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>
  /** Close the connection */
  close(): Promise<void>
}

/**
 * Migration lock operations.
 */
export interface MigrationLock {
  acquire(options?: { timeoutMs?: number; retryMs?: number }): Promise<boolean>
  release(): Promise<void>
  forceRelease(): Promise<void>
}

/**
 * Migration tracking — records which migrations have been applied.
 */
export interface MigrationTracker {
  /** Ensure the tracking table exists */
  ensureTable(): Promise<void>
  /** Get list of applied migration names */
  getApplied(): Promise<string[]>
  /** Record a migration as applied */
  record(name: string, sql: string): Promise<void>
  /** Remove a migration from tracking (rollback) */
  remove(name: string): Promise<void>
}

/**
 * Filesystem operations for migrations.
 */
export interface MigrationFs {
  /** List migration SQL files in order */
  listMigrationFiles(): Promise<string[]>
  /** Read a migration file's SQL content */
  readMigrationSql(name: string): Promise<string>
  /** Read a rollback (.down.sql) file */
  readRollbackSql(name: string): Promise<string | null>
  /** Check if a rollback file exists */
  rollbackFileExists(name: string): boolean
  /** Read rollback file content (may be TODO placeholder) */
  readRollbackContent(name: string): string | null
}

/**
 * Dependencies for db:migrate command.
 */
export interface MigrateDeps {
  db: DbClient
  lock: MigrationLock
  tracker: MigrationTracker
  fs: MigrationFs
}

/**
 * Dependencies for db:rollback command.
 */
export interface RollbackDeps {
  db: DbClient
  tracker: MigrationTracker
  fs: MigrationFs
}

/**
 * Dependencies for db:create command.
 */
export interface CreateDeps {
  /** Connect to the 'postgres' maintenance database */
  connectMaintenance(url: string): Promise<DbClient>
}

/**
 * Dependencies for db:diff command.
 */
export interface DiffDeps {
  db: DbClient
}

/**
 * Drizzle-kit abstraction for generate command.
 */
export interface DrizzleKitRunner {
  generate(entities: Array<{ name: string; file: string }>): Promise<{
    migrationFile: string | null
    sql: string | null
  }>
}

/**
 * Filesystem operations specific to generate command.
 */
export interface GenerateMigrationFs {
  writeRollbackSkeleton(migrationFile: string): Promise<void>
  writeDrizzleSchema(entities: Array<{ name: string; file: string }>): Promise<void>
}

/**
 * Dependencies for db:generate command.
 */
export interface GenerateDeps {
  drizzleKit: DrizzleKitRunner
  migrationFs: GenerateMigrationFs
}
