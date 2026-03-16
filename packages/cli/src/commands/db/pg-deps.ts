// Real PostgreSQL implementations of DB command dependencies
// Uses the 'postgres' library directly (same as adapter-drizzle-pg)

import postgres from 'postgres'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type {
  DbClient,
  MigrationLock,
  MigrationTracker,
  MigrationFs,
  CreateDeps,
} from './types'

/**
 * Create a DbClient from a postgres connection URL.
 */
export function createPgClient(url: string): DbClient {
  const sql = postgres(url, { max: 3 })

  const client: DbClient = {
    async execute(query: string): Promise<void> {
      await sql.unsafe(query)
    },
    async query<T = Record<string, unknown>>(query: string): Promise<T[]> {
      const rows = await sql.unsafe(query) as unknown as T[]
      return [...rows]
    },
    async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
      return await sql.begin(async (txSql) => {
        const txClient: DbClient = {
          async execute(query: string): Promise<void> {
            await txSql.unsafe(query)
          },
          async query<T2 = Record<string, unknown>>(query: string): Promise<T2[]> {
            const rows = await txSql.unsafe(query) as unknown as T2[]
            return [...rows]
          },
          async transaction<T2>(fn: (tx: DbClient) => Promise<T2>): Promise<T2> {
            // Nested transaction via savepoint
            return await txSql.savepoint(async (spSql) => {
              const spClient: DbClient = {
                execute: async (q) => { await spSql.unsafe(q) },
                query: async <T3 = Record<string, unknown>>(q: string) => {
                  const r = await spSql.unsafe(q) as unknown as T3[]
                  return [...r]
                },
                transaction: async () => { throw new Error('Max nesting reached') },
                close: async () => {},
              }
              return await fn(spClient)
            })
          },
          async close(): Promise<void> {},
        }
        return await fn(txClient)
      })
    },
    async close(): Promise<void> {
      await sql.end({ timeout: 5 })
    },
  }

  return client
}

/**
 * Create a DbClient for the 'postgres' maintenance database.
 * Used by db:create command.
 */
export function createPgCreateDeps(): CreateDeps {
  return {
    async connectMaintenance(url: string): Promise<DbClient> {
      return createPgClient(url)
    },
  }
}

/**
 * Advisory-lock-based migration lock using pg_advisory_lock.
 */
export function createMigrationLock(client: DbClient): MigrationLock {
  const LOCK_ID = 123456789 // Fixed advisory lock ID for Manta migrations

  return {
    async acquire(options?: { timeoutMs?: number; retryMs?: number }): Promise<boolean> {
      const timeoutMs = options?.timeoutMs ?? 10_000
      const retryMs = options?.retryMs ?? 50
      const start = Date.now()

      while (Date.now() - start < timeoutMs) {
        const rows = await client.query<{ locked: boolean }>(
          `SELECT pg_try_advisory_lock(${LOCK_ID}) as locked`,
        )
        if (rows[0]?.locked) return true
        await new Promise((r) => setTimeout(r, retryMs))
      }
      return false
    },

    async release(): Promise<void> {
      await client.query(`SELECT pg_advisory_unlock(${LOCK_ID})`)
    },

    async forceRelease(): Promise<void> {
      await client.query(`SELECT pg_advisory_unlock_all()`)
    },
  }
}

/**
 * Migration tracker backed by a _manta_migrations table.
 */
export function createMigrationTracker(client: DbClient): MigrationTracker {
  return {
    async ensureTable(): Promise<void> {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS _manta_migrations (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          applied_sql TEXT,
          applied_at TIMESTAMPTZ DEFAULT NOW()
        )
      `)
    },

    async getApplied(): Promise<string[]> {
      const rows = await client.query<{ name: string }>(
        `SELECT name FROM _manta_migrations ORDER BY id ASC`,
      )
      return rows.map((r) => r.name)
    },

    async record(name: string, sql: string): Promise<void> {
      await client.execute(
        `INSERT INTO _manta_migrations (name, applied_sql) VALUES ('${name.replace(/'/g, "''")}', '${sql.replace(/'/g, "''")}')`,
      )
    },

    async remove(name: string): Promise<void> {
      await client.execute(
        `DELETE FROM _manta_migrations WHERE name = '${name.replace(/'/g, "''")}'`,
      )
    },
  }
}

/**
 * Filesystem-based migration file operations.
 */
export function createMigrationFs(migrationsDir: string): MigrationFs {
  return {
    async listMigrationFiles(): Promise<string[]> {
      if (!existsSync(migrationsDir)) return []
      const entries = readdirSync(migrationsDir, { withFileTypes: true })
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.sql') && !e.name.endsWith('.down.sql'))
        .map((e) => e.name.replace('.sql', ''))
        .sort()
    },

    async readMigrationSql(name: string): Promise<string> {
      return readFileSync(resolve(migrationsDir, `${name}.sql`), 'utf-8')
    },

    async readRollbackSql(name: string): Promise<string | null> {
      const path = resolve(migrationsDir, `${name}.down.sql`)
      if (!existsSync(path)) return null
      return readFileSync(path, 'utf-8')
    },

    rollbackFileExists(name: string): boolean {
      return existsSync(resolve(migrationsDir, `${name}.down.sql`))
    },

    readRollbackContent(name: string): string | null {
      const path = resolve(migrationsDir, `${name}.down.sql`)
      if (!existsSync(path)) return null
      return readFileSync(path, 'utf-8')
    },
  }
}
