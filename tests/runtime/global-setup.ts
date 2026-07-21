// Global setup for the Playwright runtime smoke.
// Boots `demo/commerce` in production mode (`manta build --preset node && manta start`)
// against an ephemeral Postgres database, then writes a state file the spec reads
// to discover the baseURL. PostgreSQL is mandatory: missing infrastructure is
// a failed gate, never a silently skipped runtime suite.

import { execFileSync, spawn } from 'node:child_process'
import { unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { RUNTIME_STATE_PATH, writeRuntimeState } from './state'

const DEMO_DIR = resolve('demo/commerce')
const MANTA_BIN = resolve(DEMO_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'manta.cmd' : 'manta')
const CACHE_SERVER = resolve('tests/runtime/cache-server.ts')
const BOOTSTRAP_SCHEMA = resolve(DEMO_DIR, 'scripts/bootstrap-ci-schema.ts')
const APPLY_MIGRATIONS = resolve(DEMO_DIR, 'scripts/apply-ci-migrations.ts')
const READY_SIGNAL = 'Listening on:'
const MAX_DIAGNOSTIC_BYTES = 64 * 1024

async function globalSetup(): Promise<void> {
  if (!process.env.TEST_DATABASE_URL?.trim()) {
    throw new Error('TEST_DATABASE_URL is required for the mandatory runtime smoke')
  }

  const { createTestDatabase, waitForPg } = await import('@mantajs/test-utils/pg')

  await waitForPg()
  const database = await createTestDatabase(`runtime_smoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
  let cachePid: number | undefined
  let serverPid: number | undefined

  try {
    const dbUrl = database.url
    const dbName = new URL(dbUrl).pathname.replace(/^\//, '')
    const port = 19500 + Math.floor(Math.random() * 500)
    const cachePort = 20500 + Math.floor(Math.random() * 500)
    const cacheUrl = `http://127.0.0.1:${cachePort}`

    const runEnv: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      DATABASE_URL: dbUrl,
      JWT_SECRET: 'test-secret-for-runtime-smoke',
      COOKIE_SECRET: 'test-cookie-secret-for-runtime-smoke',
      MANTA_RUNTIME_SMOKE: '1',
      RESEND_API_KEY: 're_runtime_smoke_no_delivery',
      SHOPIFY_CATALOG_WRITES_ENABLED: 'false',
      UPSTASH_REDIS_REST_URL: cacheUrl,
      UPSTASH_REDIS_REST_TOKEN: 'runtime-smoke-token',
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

    execFileSync(MANTA_BIN, ['build', '--preset', 'node', '--no-migrate'], {
      cwd: DEMO_DIR,
      stdio: 'inherit',
      env: runEnv,
    })

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

    const baseUrl = `http://localhost:${port}`
    writeRuntimeState({ pid: child.pid, cachePid: cacheChild.pid, dbName, baseUrl })

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
