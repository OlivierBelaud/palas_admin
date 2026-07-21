// Global setup for the Playwright runtime smoke.
// Boots `demo/commerce` in production mode (`manta build --preset node && manta start`)
// against an ephemeral Postgres database, then writes a state file the spec reads
// to discover the baseURL. PostgreSQL is mandatory: missing infrastructure is
// a failed gate, never a silently skipped runtime suite.

import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { RUNTIME_STATE_PATH, writeRuntimeState } from './state'

const DEMO_DIR = resolve('demo/commerce')
const MANTA_BIN = resolve(DEMO_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'manta.cmd' : 'manta')
const CACHE_SERVER = resolve('tests/runtime/cache-server.ts')
const BOOTSTRAP_SCHEMA = resolve(DEMO_DIR, 'scripts/bootstrap-ci-schema.ts')
const APPLY_MIGRATIONS = resolve(DEMO_DIR, 'scripts/apply-ci-migrations.ts')
const PREPARE_RUNTIME_MANIFEST = resolve(DEMO_DIR, 'scripts/prepare-runtime-manifest.ts')
const PREPARE_ROOT_SPA_PUBLIC = resolve(DEMO_DIR, 'scripts/prepare-root-spa-public.mjs')
const SPA_FAVICON = resolve(DEMO_DIR, 'src/spa/admin/public/favicon.webp')
const TRACKED_FAVICON = resolve(DEMO_DIR, 'public/favicon.webp')
const READY_SIGNAL = 'Listening on:'
const MAX_DIAGNOSTIC_BYTES = 64 * 1024

async function createRuntimeDatabase(bootstrapUrl: string) {
  const { default: pg } = await import('pg')
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const dbName = `runtime_smoke_${suffix}`
  const dbRole = `runtime_smoke_role_${suffix}`
  const dbPassword = randomUUID()
  const bootstrap = new pg.Client({ connectionString: bootstrapUrl })
  await bootstrap.connect()
  try {
    await bootstrap.query(`DROP DATABASE IF EXISTS "${dbName}"`)
    await bootstrap.query(`DROP ROLE IF EXISTS "${dbRole}"`)
    await bootstrap.query(`CREATE ROLE "${dbRole}" LOGIN PASSWORD '${dbPassword}'`)
    await bootstrap.query(`CREATE DATABASE "${dbName}" OWNER "${dbRole}"`)
  } finally {
    await bootstrap.end()
  }

  const runtimeUrl = new URL(bootstrapUrl)
  if (!runtimeUrl.hostname || runtimeUrl.searchParams.get('host')?.startsWith('/')) {
    runtimeUrl.hostname = '127.0.0.1'
  }
  runtimeUrl.searchParams.delete('host')
  runtimeUrl.username = dbRole
  runtimeUrl.password = dbPassword
  runtimeUrl.pathname = `/${dbName}`
  return {
    dbName,
    dbRole,
    url: runtimeUrl.toString(),
    cleanup: async () => {
      const client = new pg.Client({ connectionString: bootstrapUrl })
      await client.connect()
      try {
        await client.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
          [dbName],
        )
        await client.query(`DROP DATABASE IF EXISTS "${dbName}"`)
        await client.query(`DROP ROLE IF EXISTS "${dbRole}"`)
      } finally {
        await client.end()
      }
    },
  }
}

async function globalSetup(): Promise<void> {
  if (!process.env.TEST_DATABASE_URL?.trim()) {
    throw new Error('TEST_DATABASE_URL is required for the mandatory runtime smoke')
  }

  const database = await createRuntimeDatabase(process.env.TEST_DATABASE_URL)
  let cachePid: number | undefined
  let serverPid: number | undefined

  try {
    const dbUrl = database.url
    const dbName = database.dbName
    const port = 19500 + Math.floor(Math.random() * 500)
    const cachePort = 20500 + Math.floor(Math.random() * 500)
    const cacheUrl = `http://127.0.0.1:${cachePort}`
    const baseUrl = `http://localhost:${port}`
    const cacheToken = 'runtime-smoke-token'
    const bootstrapAdmin = {
      email: 'runtime-admin@example.test',
      password: 'Runtime-password-354!',
      inviteToken: randomUUID(),
    }

    const runEnv: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      DATABASE_URL: dbUrl,
      JWT_SECRET: 'test-secret-for-runtime-smoke',
      COOKIE_SECRET: 'test-cookie-secret-for-runtime-smoke',
      MANTA_RUNTIME_SMOKE: '1',
      MANTA_BASE_URL: baseUrl,
      ADMIN_BASE_URL: baseUrl,
      CRON_SECRET: 'runtime-smoke-cron-secret',
      EVENT_HUB_INGEST_TOKEN: 'runtime-smoke-ingest-token',
      UNSUBSCRIBE_SECRET: 'runtime-smoke-unsubscribe-secret-0000000000000000000000000000',
      SHOPIFY_CATALOG_WRITES_ENABLED: 'false',
      UPSTASH_REDIS_REST_URL: cacheUrl,
      UPSTASH_REDIS_REST_TOKEN: cacheToken,
      RUNTIME_CACHE_PORT: String(cachePort),
      APP_ENV: 'prod',
      NODE_ENV: 'production',
    }
    process.env.DATABASE_URL = dbUrl
    process.env.JWT_SECRET = runEnv.JWT_SECRET
    process.env.NODE_ENV = 'production'
    process.env.SHOPIFY_CATALOG_WRITES_ENABLED = 'false'

    const cacheChild = spawn(process.execPath, [CACHE_SERVER], {
      cwd: DEMO_DIR,
      env: runEnv,
      stdio: 'ignore',
    })
    cachePid = cacheChild.pid

    const cacheDeadline = Date.now() + 10_000
    let cacheHealthy = false
    while (Date.now() < cacheDeadline) {
      try {
        const response = await fetch(cacheUrl, {
          body: JSON.stringify(['PING']),
          headers: { authorization: 'Bearer runtime-smoke-token', 'content-type': 'application/json' },
          method: 'POST',
        })
        if (response.ok) {
          cacheHealthy = true
          break
        }
      } catch {
        /* retry */
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
    }
    if (!cacheHealthy) {
      cacheChild.kill('SIGKILL')
      throw new Error('Runtime cache stub did not become healthy within 10s')
    }

    // Production mode deliberately never auto-creates model tables. Materialize
    // the current DML schema once through the framework's dev bootstrap, then
    // exercise the compiled production server against that isolated schema.
    execFileSync(process.execPath, [BOOTSTRAP_SCHEMA], {
      cwd: DEMO_DIR,
      stdio: 'inherit',
      env: runEnv,
    })
    execFileSync(process.execPath, [APPLY_MIGRATIONS], {
      cwd: DEMO_DIR,
      stdio: 'inherit',
      env: runEnv,
    })
    execFileSync(process.execPath, [PREPARE_RUNTIME_MANIFEST], {
      cwd: DEMO_DIR,
      stdio: 'inherit',
      env: runEnv,
    })
    execFileSync(process.execPath, [PREPARE_ROOT_SPA_PUBLIC], {
      cwd: DEMO_DIR,
      stdio: 'inherit',
      env: runEnv,
    })

    const { default: pg } = await import('pg')
    const fixtureDb = new pg.Client({ connectionString: dbUrl })
    await fixtureDb.connect()
    try {
      await fixtureDb.query(
        `INSERT INTO admin_invites
           (id, email, accepted, token, expires_at, metadata, created_at, updated_at)
         VALUES ($1, $2, false, $3, now() + interval '7 days', '{}'::jsonb, now(), now())`,
        [randomUUID(), bootstrapAdmin.email, bootstrapAdmin.inviteToken],
      )
    } finally {
      await fixtureDb.end()
    }

    try {
      execFileSync(MANTA_BIN, ['build', '--preset', 'node', '--no-migrate'], {
        cwd: DEMO_DIR,
        stdio: 'inherit',
        env: runEnv,
      })
    } finally {
      // Manta materializes the compiled SPA into demo/commerce/public and
      // replaces that directory. Keep the canonical tracked asset intact so a
      // runtime test never dirties the checkout or breaks the secret scanner.
      copyFileSync(SPA_FAVICON, TRACKED_FAVICON)
    }

    const startEnv: Record<string, string> = { ...runEnv, PORT: String(port), NITRO_PORT: String(port) }

    const child = spawn(MANTA_BIN, ['start', '--port', String(port)], {
      cwd: DEMO_DIR,
      env: startEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    serverPid = child.pid

    let stdoutBuffer = ''
    let stderrBuffer = ''
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const appendTail = (current: string, chunk: Buffer) =>
        `${current}${chunk.toString()}`.slice(-MAX_DIAGNOSTIC_BYTES)
      const cleanup = () => {
        clearTimeout(timer)
        child.stdout?.off('data', onStdout)
        child.stderr?.off('data', onStderr)
        child.off('exit', onExit)
      }
      const settle = (error?: Error) => {
        cleanup()
        child.stdout?.resume()
        child.stderr?.resume()
        if (error) rejectPromise(error)
        else resolvePromise()
      }
      const checkReady = () => {
        if (stdoutBuffer.includes(READY_SIGNAL) || stderrBuffer.includes(READY_SIGNAL)) settle()
      }
      const onStdout = (chunk: Buffer) => {
        stdoutBuffer = appendTail(stdoutBuffer, chunk)
        checkReady()
      }
      const onStderr = (chunk: Buffer) => {
        stderrBuffer = appendTail(stderrBuffer, chunk)
        checkReady()
      }
      const onExit = (code: number | null) =>
        settle(
          new Error(
            `manta start exited (code ${code}) before "${READY_SIGNAL}".\nstdout:\n${stdoutBuffer}\nstderr:\n${stderrBuffer}`,
          ),
        )
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        settle(
          new Error(
            `Timed out waiting for "${READY_SIGNAL}" (60s).\nstdout:\n${stdoutBuffer}\nstderr:\n${stderrBuffer}`,
          ),
        )
      }, 60_000)
      child.stdout?.on('data', onStdout)
      child.stderr?.on('data', onStderr)
      child.on('exit', onExit)
    })
    child.stdout?.pipe(process.stdout)
    child.stderr?.pipe(process.stderr)

    // Poll /health/live until 200 or 30s elapsed.
    const deadline = Date.now() + 30_000
    let healthy = false
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://localhost:${port}/health/live`)
        if (res.status === 200) {
          healthy = true
          break
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    if (!healthy) {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      throw new Error(
        `Health check at http://localhost:${port}/health/live never returned 200 within 30s.\nstdout:\n${stdoutBuffer}\nstderr:\n${stderrBuffer}`,
      )
    }

    writeRuntimeState({
      pid: child.pid,
      cachePid: cacheChild.pid,
      dbName,
      dbRole: database.dbRole,
      baseUrl,
      databaseUrl: dbUrl,
      cacheUrl,
      cacheToken,
      bootstrapAdmin,
    })

    child.unref()
  } catch (error) {
    for (const pid of [serverPid, cachePid]) {
      if (!pid) continue
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
    await database.cleanup().catch(() => undefined)
    try {
      unlinkSync(RUNTIME_STATE_PATH)
    } catch {
      /* state was not written */
    }
    throw error
  }
}

export default globalSetup
