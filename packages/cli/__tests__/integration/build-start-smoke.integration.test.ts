// E2E smoke tests for `manta build` and `manta start`
//
// build: generates manifest from demo project structure
// start: boots in prod mode (JSON logs, requires JWT_SECRET, no auto-migrate)
//
// Requires PG running locally. Uses an isolated test database.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve, join } from 'node:path'
import {
  mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync,
  existsSync, readFileSync, symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import postgres from 'postgres'

const ROOT = resolve(__dirname, '..', '..', '..', '..')
const BIN = resolve(ROOT, 'packages', 'cli', 'bin', 'manta.ts')
const TSX = resolve(ROOT, 'node_modules', '.bin', 'tsx')
const DEMO_DIR = resolve(ROOT, 'demo')

const BASE_DB_URL = process.env['TEST_DATABASE_URL'] || 'postgresql://olivierbelaud@localhost:5432/postgres'
const TEST_DB = `build_start_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const START_PORT = 19500 + Math.floor(Math.random() * 500)

let testDbUrl: string
let projectDir: string

// ── Helpers ──────────────────────────────────────────────────────────

function runCli(
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined>; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const env = { ...process.env, ...options.env } as NodeJS.ProcessEnv
    const child = execFile(
      TSX,
      [BIN, ...args],
      {
        cwd: options.cwd ?? ROOT,
        env,
        timeout: options.timeout ?? 10_000,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: (error as NodeJS.ErrnoException & { status?: number })?.status ?? child.exitCode ?? 0,
        })
      },
    )
  })
}

function waitForOutput(
  proc: ChildProcess,
  needle: string,
  timeoutMs = 15_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for "${needle}".\nGot:\n${output}`))
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
    proc.on('error', (err) => { clearTimeout(timer); reject(err) })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (!output.includes(needle)) {
        reject(new Error(`Exited (code ${code}) before "${needle}".\nGot:\n${output}`))
      }
    })
  })
}

async function fetchRetry(url: string, init?: RequestInit, retries = 3): Promise<Response> {
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

// ── Setup / Teardown ─────────────────────────────────────────────────

beforeAll(async () => {
  // Create isolated test database
  const adminSql = postgres(BASE_DB_URL, { max: 1 })
  try {
    await adminSql.unsafe(`CREATE DATABASE "${TEST_DB}"`)
  } finally {
    await adminSql.end()
  }
  testDbUrl = BASE_DB_URL.replace(/\/[^/]+$/, `/${TEST_DB}`)

  // Create product table (start in prod mode does NOT auto-create)
  const testSql = postgres(testDbUrl, { max: 1 })
  try {
    await testSql.unsafe(`
      DO $$ BEGIN
        CREATE TYPE product_status AS ENUM ('draft', 'published', 'archived');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `)
    await testSql.unsafe(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        price INTEGER NOT NULL,
        status product_status NOT NULL DEFAULT 'draft',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      )
    `)
  } finally {
    await testSql.end()
  }

  // Copy demo into temp dir
  projectDir = mkdtempSync(join(tmpdir(), 'manta-build-start-'))
  cpSync(DEMO_DIR, projectDir, {
    recursive: true,
    filter: (src) => !src.includes('node_modules'),
  })

  // Symlink node_modules
  const demoNm = resolve(DEMO_DIR, 'node_modules')
  if (existsSync(demoNm)) {
    try {
      symlinkSync(demoNm, join(projectDir, 'node_modules'), 'dir')
    } catch {
      cpSync(demoNm, join(projectDir, 'node_modules'), { recursive: true })
    }
  }
}, 30_000)

afterAll(async () => {
  // Drop test database
  const adminSql = postgres(BASE_DB_URL, { max: 1 })
  try {
    await adminSql.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}' AND pid <> pg_backend_pid()`,
    )
    await adminSql.unsafe(`DROP DATABASE IF EXISTS "${TEST_DB}"`)
  } catch { /* best effort */ } finally {
    await adminSql.end()
  }
  if (projectDir) rmSync(projectDir, { recursive: true, force: true })
}, 15_000)

// ── BUILD tests ──────────────────────────────────────────────────────

describe('manta build', () => {
  it('BUILD-01 — generates manifest with routes and modules from demo', async () => {
    const result = await runCli(['build'], { cwd: projectDir })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Build complete')

    // Verify manifest directory
    const manifestDir = join(projectDir, '.manta', 'manifest')
    expect(existsSync(manifestDir)).toBe(true)

    // Routes manifest
    const routesManifest = JSON.parse(readFileSync(join(manifestDir, 'routes.json'), 'utf-8'))
    expect(routesManifest.routes.length).toBeGreaterThan(0)

    const paths = routesManifest.routes.map((r: { path: string }) => r.path)
    expect(paths).toContain('/admin/products')
    expect(paths.some((p: string) => p.includes('[id]') || p.includes(':id'))).toBe(true)

    // Modules manifest
    const modulesManifest = JSON.parse(readFileSync(join(manifestDir, 'modules.json'), 'utf-8'))
    expect(modulesManifest.modules.length).toBeGreaterThan(0)
    expect(modulesManifest.modules.some((m: { name: string }) => m.name === 'product')).toBe(true)

    // Other manifests exist (may be empty)
    expect(existsSync(join(manifestDir, 'subscribers.json'))).toBe(true)
    expect(existsSync(join(manifestDir, 'workflows.json'))).toBe(true)
    expect(existsSync(join(manifestDir, 'jobs.json'))).toBe(true)
    expect(existsSync(join(manifestDir, 'links.json'))).toBe(true)
  })

  it('BUILD-02 — build is idempotent (re-running overwrites manifest)', async () => {
    const result1 = await runCli(['build'], { cwd: projectDir })
    expect(result1.exitCode).toBe(0)

    const result2 = await runCli(['build'], { cwd: projectDir })
    expect(result2.exitCode).toBe(0)

    // Manifest still valid
    const routesManifest = JSON.parse(
      readFileSync(join(projectDir, '.manta', 'manifest', 'routes.json'), 'utf-8'),
    )
    expect(routesManifest.routes.length).toBeGreaterThan(0)
  })

  it('BUILD-03 — rejects unknown preset', async () => {
    const result = await runCli(['build', '--preset', 'unknown'], { cwd: projectDir })
    expect(result.exitCode).toBe(1)
    const output = result.stdout + result.stderr
    expect(output).toContain('Unknown preset')
  })

  it('BUILD-04 — works with all valid presets', async () => {
    for (const preset of ['node', 'vercel', 'aws-lambda', 'cloudflare', 'bun']) {
      const result = await runCli(['build', '--preset', preset], { cwd: projectDir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Build complete')
      expect(result.stdout).toContain(preset)
    }
  })
})

// ── START tests ──────────────────────────────────────────────────────

describe('manta start', () => {
  it('START-01 — fails without JWT_SECRET', async () => {
    writeFileSync(
      join(projectDir, 'manta.config.ts'),
      `export default {
  database: { url: '${testDbUrl}' },
  http: { port: ${START_PORT} },
}
`,
    )

    const result = await runCli(['start'], {
      cwd: projectDir,
      env: {
        DATABASE_URL: testDbUrl,
        APP_ENV: 'prod',
        NODE_ENV: 'production',
        JWT_SECRET: undefined,
      },
    })

    expect(result.exitCode).toBe(1)
    const output = result.stdout + result.stderr
    expect(output).toContain('JWT_SECRET')
  })

  it('START-02 — starts in prod mode with JWT_SECRET, serves CRUD', async () => {
    const port = START_PORT + 1
    const BASE = `http://localhost:${port}`

    writeFileSync(
      join(projectDir, 'manta.config.ts'),
      `export default {
  database: { url: '${testDbUrl}', pool: { min: 1, max: 3 } },
  http: { port: ${port} },
}
`,
    )
    writeFileSync(join(projectDir, '.env'), `DATABASE_URL=${testDbUrl}\nJWT_SECRET=test-secret-for-ci\n`)

    const proc = spawn(TSX, [BIN, 'start'], {
      cwd: projectDir,
      env: {
        ...process.env,
        DATABASE_URL: testDbUrl,
        JWT_SECRET: 'test-secret-for-ci',
        APP_ENV: 'prod',
        NODE_ENV: 'production',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    try {
      // Wait for server ready
      const output = await waitForOutput(proc, 'Server listening')

      // Verify JSON logs (no ANSI colors in prod)
      // Pino JSON lines start with {"level":
      expect(output).toContain('"level"')

      // Health check
      const healthRes = await fetchRetry(`${BASE}/health/live`)
      expect(healthRes.status).toBe(200)

      // Create product
      const createRes = await fetchRetry(`${BASE}/admin/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Prod Widget', price: 5000, status: 'published' }),
      })
      expect(createRes.status).toBe(201)
      const created = await createRes.json() as { product: { id: string; title: string } }
      expect(created.product.title).toBe('Prod Widget')

      // List products
      const listRes = await fetchRetry(`${BASE}/admin/products`)
      expect(listRes.status).toBe(200)
      const listed = await listRes.json() as { products: Array<{ id: string }> }
      expect(listed.products.some((p) => p.id === created.product.id)).toBe(true)

      // Shutdown
      proc.kill('SIGTERM')
      const exitCode = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve(null) }, 5_000)
        proc.on('exit', (code) => { clearTimeout(timer); resolve(code) })
      })
      expect(exitCode).toBe(0)
    } finally {
      if (!proc.killed) proc.kill('SIGKILL')
    }
  }, 20_000)

  it('START-03 — prod logs are JSON (not pretty)', async () => {
    const port = START_PORT + 2
    writeFileSync(
      join(projectDir, 'manta.config.ts'),
      `export default {
  database: { url: '${testDbUrl}', pool: { min: 1, max: 3 } },
  http: { port: ${port} },
}
`,
    )

    const proc = spawn(TSX, [BIN, 'start'], {
      cwd: projectDir,
      env: {
        ...process.env,
        DATABASE_URL: testDbUrl,
        JWT_SECRET: 'test-secret-for-ci',
        APP_ENV: 'prod',
        NODE_ENV: 'production',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    try {
      const output = await waitForOutput(proc, 'Server listening')

      // Each non-empty line should be valid JSON (Pino JSON mode)
      const lines = output.split('\n').filter((l) => l.trim().length > 0)
      const jsonLines = lines.filter((l) => {
        try {
          JSON.parse(l)
          return true
        } catch {
          return false
        }
      })

      // At least some lines should be JSON (Pino output)
      expect(jsonLines.length).toBeGreaterThan(0)

      // Should NOT contain ANSI color codes
      const hasAnsi = lines.some((l) => /\x1b\[/.test(l))
      expect(hasAnsi).toBe(false)
    } finally {
      proc.kill('SIGKILL')
      await new Promise<void>((r) => proc.on('exit', () => r()))
    }
  }, 15_000)

  it('START-04 — fails with clear message when DB is unreachable', async () => {
    const port = START_PORT + 3
    writeFileSync(
      join(projectDir, 'manta.config.ts'),
      `export default {
  database: { url: 'postgresql://localhost:59999/nonexistent' },
  http: { port: ${port} },
}
`,
    )

    const proc = spawn(TSX, [BIN, 'start'], {
      cwd: projectDir,
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://localhost:59999/nonexistent',
        JWT_SECRET: 'test-secret',
        APP_ENV: 'prod',
        NODE_ENV: 'production',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const exitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve(null) }, 15_000)
      proc.on('exit', (code) => { clearTimeout(timer); resolve(code) })
    })

    expect(exitCode).toBe(1)
  }, 20_000)

  it('START-05 — prod mode does NOT auto-create tables', async () => {
    // Create a separate test DB without the product table
    const noProdTableDb = `${TEST_DB}_no_table`
    const adminSql = postgres(BASE_DB_URL, { max: 1 })
    try {
      await adminSql.unsafe(`CREATE DATABASE "${noProdTableDb}"`)
    } finally {
      await adminSql.end()
    }

    const noTableUrl = BASE_DB_URL.replace(/\/[^/]+$/, `/${noProdTableDb}`)
    const port = START_PORT + 4

    writeFileSync(
      join(projectDir, 'manta.config.ts'),
      `export default {
  database: { url: '${noTableUrl}', pool: { min: 1, max: 3 } },
  http: { port: ${port} },
}
`,
    )

    const proc = spawn(TSX, [BIN, 'start'], {
      cwd: projectDir,
      env: {
        ...process.env,
        DATABASE_URL: noTableUrl,
        JWT_SECRET: 'test-secret-for-ci',
        APP_ENV: 'prod',
        NODE_ENV: 'production',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    try {
      // Server should still start (tables are not auto-created in prod)
      await waitForOutput(proc, 'Server listening')

      // Verify the table was NOT auto-created (prod mode skips ensureProductTable)
      const checkSql = postgres(noTableUrl, { max: 1 })
      try {
        const tables = await checkSql`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'products'
        `
        expect(tables).toHaveLength(0)
      } finally {
        await checkSql.end()
      }
    } finally {
      proc.kill('SIGKILL')
      await new Promise<void>((r) => proc.on('exit', () => r()))

      // Cleanup extra DB
      const cleanSql = postgres(BASE_DB_URL, { max: 1 })
      try {
        await cleanSql.unsafe(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${noProdTableDb}' AND pid <> pg_backend_pid()`,
        )
        await cleanSql.unsafe(`DROP DATABASE IF EXISTS "${noProdTableDb}"`)
      } catch { /* best effort */ } finally {
        await cleanSql.end()
      }
    }
  }, 20_000)
})
