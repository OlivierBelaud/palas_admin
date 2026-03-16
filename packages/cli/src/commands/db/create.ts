// SPEC-070 — manta db:create command

import type { CreateDeps } from './types'

export interface CreateCommandResult {
  exitCode: number
  errors: string[]
  created: boolean
  dbName: string
}

/**
 * Extract the database name from a PostgreSQL URL.
 */
export function extractDbName(url: string): string {
  try {
    // postgresql://user:pass@host:port/dbname
    const parsed = new URL(url)
    const pathname = parsed.pathname
    return pathname.startsWith('/') ? pathname.slice(1) : pathname
  } catch {
    // Fallback: extract last path segment
    const lastSlash = url.lastIndexOf('/')
    if (lastSlash === -1) return ''
    const dbPart = url.slice(lastSlash + 1)
    // Remove query params
    const qIndex = dbPart.indexOf('?')
    return qIndex === -1 ? dbPart : dbPart.slice(0, qIndex)
  }
}

/**
 * Build the maintenance URL (connect to 'postgres' database instead of target).
 */
function buildMaintenanceUrl(originalUrl: string): string {
  try {
    const parsed = new URL(originalUrl)
    parsed.pathname = '/postgres'
    return parsed.toString()
  } catch {
    // Fallback: replace last path segment
    const lastSlash = originalUrl.lastIndexOf('/')
    if (lastSlash === -1) return originalUrl
    return originalUrl.slice(0, lastSlash) + '/postgres'
  }
}

/**
 * manta db:create — Create the database if it doesn't exist.
 * Accepts injectable deps for testability (hexagonal architecture).
 */
export async function createCommand(
  databaseUrl: string,
  deps: CreateDeps,
): Promise<CreateCommandResult> {
  const dbName = extractDbName(databaseUrl)
  const result: CreateCommandResult = {
    exitCode: 0,
    errors: [],
    created: false,
    dbName,
  }

  if (!dbName) {
    result.exitCode = 1
    result.errors.push('Cannot extract database name from URL')
    return result
  }

  let client
  try {
    // Connect to maintenance DB (postgres)
    const maintenanceUrl = buildMaintenanceUrl(databaseUrl)
    client = await deps.connectMaintenance(maintenanceUrl)

    // Check if DB exists
    const rows = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname = '${dbName}'`,
    )

    if (rows.length > 0) {
      // Already exists
      result.created = false
    } else {
      // Create the database
      await client.execute(`CREATE DATABASE "${dbName}"`)
      result.created = true
    }
  } catch (err) {
    result.exitCode = 1
    const message = err instanceof Error ? err.message : String(err)
    result.errors.push(`Failed to create database: ${message}`)
    result.created = false
  } finally {
    if (client) {
      await client.close()
    }
  }

  return result
}
