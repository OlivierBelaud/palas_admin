// Test utility for PostgreSQL integration tests
// Creates isolated databases per test file for parallel execution

const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/manta_test_main'

/**
 * Creates an isolated test database.
 * Each test file gets its own database for parallel execution.
 */
export async function createTestDatabase(name?: string): Promise<{
  url: string
  cleanup: () => Promise<void>
}> {
  // Dynamic import to avoid requiring pg for unit tests
  const { default: pg } = await import('pg')
  const { Client } = pg

  const dbName = name || `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const client = new Client({ connectionString: TEST_DB_URL })
  await client.connect()
  await client.query(`DROP DATABASE IF EXISTS "${dbName}"`)
  await client.query(`CREATE DATABASE "${dbName}"`)
  await client.end()

  const url = TEST_DB_URL.replace(/\/[^/]+$/, `/${dbName}`)

  return {
    url,
    cleanup: async () => {
      const c = new Client({ connectionString: TEST_DB_URL })
      await c.connect()
      // Kill active connections before dropping
      await c.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '${dbName}' AND pid <> pg_backend_pid()
      `)
      await c.query(`DROP DATABASE IF EXISTS "${dbName}"`)
      await c.end()
    },
  }
}

/**
 * Waits for PostgreSQL to be accessible.
 * Used in globalSetup for integration tests.
 */
export async function waitForPg(maxRetries = 30): Promise<void> {
  const { default: pg } = await import('pg')
  const { Client } = pg

  for (let i = 0; i < maxRetries; i++) {
    const client = new Client({ connectionString: TEST_DB_URL })
    try {
      await client.connect()
      await client.query('SELECT 1')
      await client.end()
      return
    } catch {
      try {
        await client.end()
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  throw new Error(`PostgreSQL not reachable at ${TEST_DB_URL} after ${maxRetries}s`)
}
