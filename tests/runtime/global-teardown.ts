// Global teardown for the Playwright runtime smoke.
// Kills the manta start child, drops the ephemeral database, and removes the tempdir.

import { existsSync, unlinkSync } from 'node:fs'
import { RUNTIME_AUTH_PATH, RUNTIME_STATE_PATH, readRuntimeState } from './state'

async function isAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function globalTeardown(): Promise<void> {
  if (!existsSync(RUNTIME_STATE_PATH)) return

  const state = readRuntimeState()

  try {
    for (const pid of [state.pid, state.cachePid]) {
      if (!pid) continue
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        /* already gone */
      }

      const killDeadline = Date.now() + 5_000
      while (Date.now() < killDeadline) {
        if (!(await isAlive(pid))) break
        await new Promise((r) => setTimeout(r, 100))
      }
      if (await isAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* ignore */
        }
      }
    }

    if (state.dbName && process.env.TEST_DATABASE_URL) {
      try {
        const { default: pg } = await import('pg')
        const { Client } = pg
        const client = new Client({ connectionString: process.env.TEST_DATABASE_URL })
        await client.connect()
        try {
          await client.query(
            `
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()
          `,
            [state.dbName],
          )
          await client.query(`DROP DATABASE IF EXISTS "${state.dbName}"`)
          if (state.dbRole) await client.query(`DROP ROLE IF EXISTS "${state.dbRole}"`)
        } finally {
          await client.end()
        }
      } catch {
        /* best effort */
      }
    }
  } finally {
    try {
      unlinkSync(RUNTIME_STATE_PATH)
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(RUNTIME_AUTH_PATH)
    } catch {
      /* ignore */
    }
  }
}

export default globalTeardown
