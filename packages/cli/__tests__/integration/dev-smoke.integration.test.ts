// E2E smoke test for `manta dev`
// Spawns the real CLI, boots against a live PG,
// exercises the full CRUD flow, then shuts down cleanly.
//
// Requires PG running locally. Uses an isolated test database.

import { type ChildProcess, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { TEST_DB_URL } from '@manta/test-utils/pg'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..', '..', '..', '..')
const BIN = resolve(ROOT, 'packages', 'cli', 'bin', 'manta.ts')
const TSX = resolve(ROOT, 'node_modules', '.bin', 'tsx')
const DEMO_DIR = resolve(ROOT, 'demo')

// Canonical TEST_DATABASE_URL source: @manta/test-utils/pg (BC-F21)
const BASE_DB_URL = TEST_DB_URL
const TEST_DB = `smoke_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const TEST_PORT = 19000 + Math.floor(Math.random() * 1000)

let testDbUrl: string
let projectDir: string

/**
 * Wait for a string to appear in the process output.
 */
function waitForOutput(proc: ChildProcess, needle: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for "${needle}" in output.\nGot:\n${output}`))
    }, timeoutMs)

    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes(needle)) {
        clearTimeout(timer)
        proc.stdout?.off('data', onData)
        proc.stderr?.off('data', onData)
        resolve(output)
      }
    }

    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (!output.includes(needle)) {
        reject(new Error(`Process exited (code ${code}) before "${needle}" appeared.\nGot:\n${output}`))
      }
    })
  })
}

/**
 * HTTP fetch helper with retry for server startup race.
 */
async function fetchWithRetry(url: string, init?: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, init)
    } catch {
      if (i === retries - 1) throw new Error(`Failed to fetch ${url} after ${retries} retries`)
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error('unreachable')
}

describe('E2E smoke test — manta dev', () => {
  // ── Setup: create test database + project ──────────────────────────

  beforeAll(async () => {
    // Create isolated test database
    const adminSql = postgres(BASE_DB_URL, { max: 1 })
    try {
      await adminSql.unsafe(`CREATE DATABASE "${TEST_DB}"`)
    } finally {
      await adminSql.end()
    }

    testDbUrl = BASE_DB_URL.replace(/\/[^/]+$/, `/${TEST_DB}`)

    // Copy the demo project into a temp dir so we don't pollute the real demo
    projectDir = mkdtempSync(join(tmpdir(), 'manta-smoke-'))
    cpSync(DEMO_DIR, projectDir, {
      recursive: true,
      filter: (src) => !src.includes('node_modules'),
    })

    // Rewrite the config to use test DB + random port
    writeFileSync(
      join(projectDir, 'manta.config.ts'),
      `export default {
  database: { url: '${testDbUrl}', pool: { min: 1, max: 3 } },
  http: { port: ${TEST_PORT} },
  appEnv: 'dev',
}
`,
    )

    // Write .env
    writeFileSync(join(projectDir, '.env'), `DATABASE_URL=${testDbUrl}\n`)

    // Symlink node_modules from demo so imports resolve
    const demoNodeModules = resolve(DEMO_DIR, 'node_modules')
    if (existsSync(demoNodeModules)) {
      const { symlinkSync } = await import('node:fs')
      try {
        symlinkSync(demoNodeModules, join(projectDir, 'node_modules'), 'dir')
      } catch {
        // If symlink fails (already exists), copy instead
        cpSync(demoNodeModules, join(projectDir, 'node_modules'), { recursive: true })
      }
    }
  }, 30_000)

  afterAll(async () => {
    // Drop the test database
    const adminSql = postgres(BASE_DB_URL, { max: 1 })
    try {
      // Terminate active connections
      await adminSql.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}' AND pid <> pg_backend_pid()`,
      )
      await adminSql.unsafe(`DROP DATABASE IF EXISTS "${TEST_DB}"`)
    } catch {
      // Best-effort cleanup
    } finally {
      await adminSql.end()
    }

    // Clean up temp dir
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true })
    }
  }, 15_000)

  // ── The smoke test ─────────────────────────────────────────────────

  it('full CRUD lifecycle: start → POST → GET → GET/:id → PUT → DELETE → shutdown', async () => {
    const BASE = `http://localhost:${TEST_PORT}`

    // 1. Spawn `manta dev`
    const proc = spawn(TSX, [BIN, 'dev'], {
      cwd: projectDir,
      env: { ...process.env, DATABASE_URL: testDbUrl },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    try {
      // 2. Wait for "Server listening"
      await waitForOutput(proc, 'Server listening')

      // 3. Health check
      const healthRes = await fetchWithRetry(`${BASE}/health/live`)
      expect(healthRes.status).toBe(200)
      const healthBody = (await healthRes.json()) as { status: string }
      expect(healthBody.status).toBe('alive')

      // 4. POST /admin/products — create a product
      const createRes = await fetchWithRetry(`${BASE}/admin/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Smoke Test Widget', price: 4200, status: 'draft' }),
      })
      expect(createRes.status).toBe(201)
      const createBody = (await createRes.json()) as {
        product: { id: string; title: string; price: number; status: string }
      }
      expect(createBody.product.title).toBe('Smoke Test Widget')
      expect(createBody.product.price).toBe(4200)
      expect(createBody.product.status).toBe('draft')
      expect(createBody.product.id).toMatch(/^prod_/)

      const productId = createBody.product.id

      // 5. GET /admin/products — list products, should contain our product
      const listRes = await fetchWithRetry(`${BASE}/admin/products`)
      expect(listRes.status).toBe(200)
      const listBody = (await listRes.json()) as {
        products: Array<{ id: string; title: string }>
      }
      expect(listBody.products.some((p) => p.id === productId)).toBe(true)

      // 6. GET /admin/products/:id — get by ID
      const getRes = await fetchWithRetry(`${BASE}/admin/products/${productId}`)
      expect(getRes.status).toBe(200)
      const getBody = (await getRes.json()) as {
        product: { id: string; title: string; price: number }
      }
      expect(getBody.product.id).toBe(productId)
      expect(getBody.product.title).toBe('Smoke Test Widget')

      // 7. PUT /admin/products/:id — update the product
      const updateRes = await fetchWithRetry(`${BASE}/admin/products/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated Widget', price: 9900 }),
      })
      expect(updateRes.status).toBe(200)
      const updateBody = (await updateRes.json()) as {
        product: { id: string; title: string; price: number }
      }
      expect(updateBody.product.title).toBe('Updated Widget')
      expect(updateBody.product.price).toBe(9900)

      // 8. DELETE /admin/products/:id — soft-delete
      const deleteRes = await fetchWithRetry(`${BASE}/admin/products/${productId}`, {
        method: 'DELETE',
      })
      expect(deleteRes.status).toBe(204)

      // 9. GET /admin/products — deleted product should NOT appear
      const listAfterDelete = await fetchWithRetry(`${BASE}/admin/products`)
      expect(listAfterDelete.status).toBe(200)
      const listAfterBody = (await listAfterDelete.json()) as {
        products: Array<{ id: string }>
      }
      expect(listAfterBody.products.some((p) => p.id === productId)).toBe(false)

      // 10. POST with invalid data — should get 400
      const invalidRes = await fetchWithRetry(`${BASE}/admin/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'no title or price' }),
      })
      expect(invalidRes.status).toBe(400)

      // 11. GET non-existent product — should get 404
      const notFoundRes = await fetchWithRetry(`${BASE}/admin/products/prod_nonexistent`)
      expect(notFoundRes.status).toBe(404)
    } finally {
      // 12. SIGINT → clean shutdown
      proc.kill('SIGINT')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          proc.kill('SIGKILL')
          resolve()
        }, 5_000)
        proc.on('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  }, 30_000)

  it('manta dev exits cleanly on SIGTERM', async () => {
    const proc = spawn(TSX, [BIN, 'dev'], {
      cwd: projectDir,
      env: { ...process.env, DATABASE_URL: testDbUrl },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    try {
      await waitForOutput(proc, 'Server listening')

      // Send SIGTERM
      proc.kill('SIGTERM')

      const exitCode = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => {
          proc.kill('SIGKILL')
          resolve(null)
        }, 5_000)
        proc.on('exit', (code) => {
          clearTimeout(timer)
          resolve(code)
        })
      })

      expect(exitCode).toBe(0)
    } finally {
      if (!proc.killed) proc.kill('SIGKILL')
    }
  }, 15_000)

  it('manta dev fails with clear message on wrong DB URL', async () => {
    const badDir = mkdtempSync(join(tmpdir(), 'manta-bad-db-'))

    // Copy project but with a bad DB URL
    cpSync(projectDir, badDir, {
      recursive: true,
      filter: (src) => !src.includes('node_modules') && !src.includes('manta.config'),
    })

    writeFileSync(
      join(badDir, 'manta.config.ts'),
      `export default {
  database: { url: 'postgresql://localhost:59999/nonexistent' },
  http: { port: ${TEST_PORT + 1} },
}
`,
    )
    writeFileSync(join(badDir, '.env'), `DATABASE_URL=postgresql://localhost:59999/nonexistent\n`)

    // Symlink node_modules
    try {
      const { symlinkSync } = await import('node:fs')
      symlinkSync(join(projectDir, 'node_modules'), join(badDir, 'node_modules'), 'dir')
    } catch {
      // ignore
    }

    const proc = spawn(TSX, [BIN, 'dev'], {
      cwd: badDir,
      env: { ...process.env, DATABASE_URL: 'postgresql://localhost:59999/nonexistent' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const exitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        proc.kill('SIGKILL')
        resolve(null)
      }, 15_000)
      proc.on('exit', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })

    expect(exitCode).toBe(1)

    rmSync(badDir, { recursive: true, force: true })
  }, 20_000)
})
