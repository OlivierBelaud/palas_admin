// Global teardown for the Playwright runtime smoke.
// Kills the manta start child, drops the ephemeral database, and removes the tempdir.

import { existsSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const STATE_PATH = resolve('tests/runtime/.state.json')

interface State {
  skipped: boolean
  reason?: string
  port?: number
  pid?: number
  tempDir?: string
  dbName?: string
  baseUrl?: string
}

async function isAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function globalTeardown(): Promise<void> {
  if (!existsSync(STATE_PATH)) return

  const state = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as State

  try {
    if (state.skipped) return

    if (state.pid) {
      try {
        process.kill(state.pid, 'SIGTERM')
      } catch {
        /* already gone */
      }

      const killDeadline = Date.now() + 5_000
      while (Date.now() < killDeadline) {
        if (!(await isAlive(state.pid))) break
        await new Promise((r) => setTimeout(r, 100))
      }
      if (await isAlive(state.pid)) {
        try {
          process.kill(state.pid, 'SIGKILL')
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
          await client.query(`
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = '${state.dbName}' AND pid <> pg_backend_pid()
          `)
          await client.query(`DROP DATABASE IF EXISTS "${state.dbName}"`)
        } finally {
          await client.end()
        }
      } catch {
        /* best effort */
      }
    }

    if (state.tempDir) {
      rmSync(state.tempDir, { recursive: true, force: true })
    }
  } finally {
    try {
      unlinkSync(STATE_PATH)
    } catch {
      /* ignore */
    }
  }
}

export default globalTeardown
