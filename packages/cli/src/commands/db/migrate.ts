// SPEC-014 — manta db:migrate command

import type { MigrateDeps } from './types'

export interface MigrateOptions {
  forceUnlock?: boolean
  dryRun?: boolean
  allOrNothing?: boolean
}

export interface MigrateCommandResult {
  exitCode: number
  errors: string[]
  warnings: string[]
  appliedCount: number
  pendingCount: number
  dryRunSql?: string[]
}

/**
 * Check if migration SQL contains CREATE INDEX CONCURRENTLY.
 * Incompatible with --all-or-nothing mode.
 */
export function detectConcurrentIndex(sql: string): boolean {
  return /CREATE\s+INDEX\s+CONCURRENTLY/i.test(sql)
}

/**
 * Parse pending migrations from filesystem vs tracking table.
 */
export function findPendingMigrations(
  filesystemMigrations: string[],
  appliedMigrations: string[],
): string[] {
  const appliedSet = new Set(appliedMigrations)
  return filesystemMigrations.filter((m) => !appliedSet.has(m))
}

/**
 * manta db:migrate — Apply pending SQL migrations.
 * Accepts injectable deps for testability (hexagonal architecture).
 */
export async function migrateCommand(
  options: MigrateOptions = {},
  deps: MigrateDeps,
): Promise<MigrateCommandResult> {
  const result: MigrateCommandResult = {
    exitCode: 0,
    errors: [],
    warnings: [],
    appliedCount: 0,
    pendingCount: 0,
  }

  // --force-unlock: release the lock and exit immediately
  if (options.forceUnlock) {
    await deps.lock.forceRelease()
    return result
  }

  // Step 1: Acquire migration lock
  const locked = await deps.lock.acquire()
  if (!locked) {
    result.exitCode = 1
    result.errors.push('Could not acquire migration lock (timeout)')
    return result
  }

  try {
    // Step 2: Ensure tracking table exists
    await deps.tracker.ensureTable()

    // Step 3: Detect pending migrations
    const allFiles = await deps.fs.listMigrationFiles()
    const applied = await deps.tracker.getApplied()
    const pending = findPendingMigrations(allFiles, applied)
    result.pendingCount = pending.length

    if (pending.length === 0) {
      return result
    }

    // Step 4: Read SQL for all pending migrations
    const migrations: Array<{ name: string; sql: string }> = []
    for (const name of pending) {
      const sql = await deps.fs.readMigrationSql(name)
      migrations.push({ name, sql })
    }

    // Step 5: --all-or-nothing pre-check for CONCURRENT INDEX
    if (options.allOrNothing) {
      for (const { name, sql } of migrations) {
        if (detectConcurrentIndex(sql)) {
          result.exitCode = 1
          result.errors.push(
            `Migration ${name} contains CREATE INDEX CONCURRENTLY which is incompatible with --all-or-nothing (transactions)`,
          )
          return result
        }
      }
    }

    // Step 6: --dry-run — return SQL without executing
    if (options.dryRun) {
      result.dryRunSql = migrations.map((m) => m.sql)
      return result
    }

    // Step 7: Apply migrations
    if (options.allOrNothing) {
      // All-or-nothing: wrap in a single transaction
      try {
        await deps.db.transaction(async (tx) => {
          for (const { sql } of migrations) {
            await tx.execute(sql)
          }
        })
        // If transaction succeeded, record all
        for (const { name, sql } of migrations) {
          await deps.tracker.record(name, sql)
        }
        result.appliedCount = migrations.length
      } catch (err) {
        // Transaction rolled back — nothing applied
        result.exitCode = 1
        result.appliedCount = 0
        const message = err instanceof Error ? err.message : String(err)
        result.errors.push(`All migrations rolled back: ${message}`)
      }
    } else {
      // Apply one by one — partial failure records only successful ones
      for (const { name, sql } of migrations) {
        try {
          await deps.db.execute(sql)
          await deps.tracker.record(name, sql)
          result.appliedCount++
        } catch (err) {
          result.exitCode = 1
          const message = err instanceof Error ? err.message : String(err)
          result.errors.push(`Migration ${name} failed: ${message}`)
          break
        }
      }
    }
  } finally {
    // Always release the lock
    await deps.lock.release()
  }

  return result
}
