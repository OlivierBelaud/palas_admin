// SPEC-014 — manta db:rollback command

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RollbackDeps } from './types'

export interface RollbackOptions {
  steps?: number
}

export interface RollbackCommandResult {
  exitCode: number
  errors: string[]
  rolledBack: string[]
}

// Rollback validation uses content inspection (no SQL = skeleton only)

/**
 * Validate a rollback SQL file.
 * Returns null if valid, error message if invalid.
 */
export function validateRollbackFile(filePath: string, cwd: string = process.cwd()): string | null {
  const fullPath = resolve(cwd, filePath)

  if (!existsSync(fullPath)) {
    return `Rollback file not found: ${filePath}\nCreate the rollback SQL manually and try again.`
  }

  const content = readFileSync(fullPath, 'utf-8').trim()
  // Detect unmodified skeleton (all lines are comments or empty)
  const hasRealSql = content.split('\n').some((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith('--')
  })
  if (!hasRealSql) {
    return `Rollback file has no SQL: ${filePath}\nIt contains only comments. Write the rollback SQL or revert your model and run \`manta db:generate\`.`
  }

  return null
}

/**
 * manta db:rollback — Rollback the last N migrations.
 * Stops at first failure. Best-effort.
 * Accepts injectable deps for testability (hexagonal architecture).
 */
export async function rollbackCommand(
  options: RollbackOptions = {},
  deps: RollbackDeps,
): Promise<RollbackCommandResult> {
  const result: RollbackCommandResult = { exitCode: 0, errors: [], rolledBack: [] }
  const steps = options.steps ?? 1

  // Step 1: Get applied migrations
  const applied = await deps.tracker.getApplied()

  if (applied.length === 0) {
    return result
  }

  // Step 2: Take the last N applied migrations in reverse order
  const toRollback = applied.slice(-steps).reverse()

  // Step 3: For each migration in reverse order
  for (const name of toRollback) {
    // Check if rollback file exists
    if (!deps.fs.rollbackFileExists(name)) {
      result.exitCode = 1
      result.errors.push(`Rollback file not found: ${name}\nCreate the rollback SQL manually and try again.`)
      break
    }

    // Check if rollback file has real SQL (not just comments/skeleton)
    const content = deps.fs.readRollbackContent(name)
    const hasRealSql = content
      ? content.split('\n').some((line) => {
          const trimmed = line.trim()
          return trimmed.length > 0 && !trimmed.startsWith('--')
        })
      : false
    if (!hasRealSql) {
      result.exitCode = 1
      result.errors.push(
        `Rollback file has no SQL: ${name}\nIt contains only comments. Write the rollback SQL or revert your model and run \`manta db:generate\`.`,
      )
      break
    }

    // Execute the rollback SQL in a transaction
    try {
      const sql = await deps.fs.readRollbackSql(name)
      if (!sql) {
        result.exitCode = 1
        result.errors.push(`Could not read rollback SQL for ${name}`)
        break
      }

      await deps.db.transaction(async (tx) => {
        await tx.execute(sql)
      })

      // Update tracking
      await deps.tracker.remove(name)
      result.rolledBack.push(name)
    } catch (err) {
      result.exitCode = 1
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(
        `Rollback failed for ${name}: ${message}\nDatabase may be in an inconsistent state. Consider using a forward fix.`,
      )
      break
    }
  }

  return result
}
