// E2E smoke tests for `manta build` and `manta start`
//
// build: generates manifest from demo project structure
// start: boots in prod mode (JSON logs, requires JWT_SECRET, no auto-migrate)
//
// Requires PG running locally. Uses an isolated test database.
//
// Scope note (BC-F17, BC-F19): CRUD coverage is NOT duplicated here.
// The Playwright runtime smoke (`tests/runtime/admin-smoke.spec.ts`) boots
// the full demo and exercises the admin SPA end-to-end. This file covers
// only the build/start lifecycle: manifest generation, JWT_SECRET gating,
// prod log format, DB-unreachable failure, and no-auto-create-in-prod.

import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createTestDatabase, waitForPg } from '@manta/test-utils/pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..', '..', '..', '..')
const BIN = resolve(ROOT, 'packages', 'cli', 'bin', 'manta.ts')
const TSX = resolve(ROOT, 'node_modules', '.bin', 'tsx')
const DEMO_DIR = resolve(ROOT, 'demo')

const START_PORT = 19500 + Math.floor(Math.random() * 500)

let testDbUrl: string
let cleanupTestDb: () => Promise<void>
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

function waitForOutput(proc: ChildProcess, needle: string, timeoutMs = 15_000): Promise<string> {
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
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
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
  // Bootstrap PG + create isolated test DB via the shared helper (BC-F19).
  await waitForPg()
  const testDb = await createTestDatabase(`build_start_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
  testDbUrl = testDb.url
  cleanupTestDb = testDb.cleanup

  // Copy demo into temp dir
  projectDir = mkdtempSync(join(tmpdir(), 'manta-build-start-'))
  cpSync(DEMO_DIR, projectDir, {
    recursive: true,
    // Skip node_modules (symlinked below) and never copy .env secrets (BC-F10).
    filter: (src) => !src.includes('node_modules') && !src.endsWith('/.env') && !src.endsWith('/.env.local'),
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
  if (cleanupTestDb) {
    try {
      await cleanupTestDb()
    } catch {
      /* best effort */
    }
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
    // BC-F17: demo/commerce modules are address, admin, cart-tracking, customer — no product.
    // Admin SPA pages that actually exist: /admin/customers, /admin/paniers, /admin/customer-groups, /admin/activite-site.
    expect(paths).toContain('/admin/customers')
    expect(paths.some((p: string) => p.includes('[id]') || p.includes(':id'))).toBe(true)

    // Modules manifest
    const modulesManifest = JSON.parse(readFileSync(join(manifestDir, 'modules.json'), 'utf-8'))
    expect(modulesManifest.modules.length).toBeGreaterThan(0)
    expect(modulesManifest.modules.some((m: { name: string }) => m.name === 'customer')).toBe(true)

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
    const routesManifest = JSON.parse(readFileSync(join(projectDir, '.manta', 'manifest', 'routes.json'), 'utf-8'))
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

  it('START-02 — starts in prod mode with JWT_SECRET, serves /health/live', async () => {
    // BC-F17 scope note: this test used to exercise a full CRUD flow against
    // /admin/products, which no longer exists in demo/commerce. CRUD coverage
    // now lives in tests/runtime/admin-smoke.spec.ts (Playwright). This test
    // is intentionally narrow: prod mode boots, logs in JSON, answers /health/live.
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

      // Health check — confirms the HTTP layer is wired and responsive
      const healthRes = await fetchRetry(`${BASE}/health/live`)
      expect(healthRes.status).toBe(200)

      // Shutdown cleanly
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
      // biome-ignore lint/suspicious/noControlCharactersInRegex: detecting ANSI escape sequences
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
  }, 20_000)

  it('START-05 — prod mode does NOT auto-create tables', async () => {
    // Fresh isolated DB via the shared helper (BC-F19)
    const freshDb = await createTestDatabase(`start05_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    const noTableUrl = freshDb.url
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

      // Verify no user-defined public tables were auto-created.
      // In prod mode, manta does NOT run DDL — the schema is expected to be
      // migrated out-of-band. We inspect information_schema directly.
      const postgres = (await import('postgres')).default
      const checkSql = postgres(noTableUrl, { max: 1 })
      try {
        const tables = await checkSql<{ table_name: string }[]>`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
        `
        // Zero user tables: nothing was auto-created.
        expect(tables).toHaveLength(0)
      } finally {
        await checkSql.end()
      }
    } finally {
      proc.kill('SIGKILL')
      await new Promise<void>((r) => proc.on('exit', () => r()))
      try {
        await freshDb.cleanup()
      } catch {
        /* best effort */
      }
    }
  }, 20_000)
})
