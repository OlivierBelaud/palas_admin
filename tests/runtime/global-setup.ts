// Global setup for the Playwright runtime smoke.
// Boots `demo/commerce` in production mode (`manta build --preset node && manta start`)
// against an ephemeral Postgres database, then writes a state file the spec reads
// to discover the baseURL (or to skip cleanly when no TEST_DATABASE_URL is set).

import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const STATE_PATH = resolve('tests/runtime/.state.json')
const DEMO_DIR = resolve('demo/commerce')
const READY_SIGNAL = 'Server listening'

async function globalSetup(): Promise<void> {
  if (!process.env.TEST_DATABASE_URL) {
    writeFileSync(STATE_PATH, JSON.stringify({ skipped: true, reason: 'no TEST_DATABASE_URL' }, null, 2))
    return
  }

  const { createTestDatabase, waitForPg } = await import('@manta/test-utils/pg')

  await waitForPg()
  const { url: dbUrl } = await createTestDatabase(
    `runtime_smoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  )
  const dbName = new URL(dbUrl).pathname.replace(/^\//, '')

  const tempDir = mkdtempSync(join(tmpdir(), 'manta-runtime-'))
  const projectDir = join(tempDir, 'commerce')

  cpSync(DEMO_DIR, projectDir, {
    recursive: true,
    filter: (src) => !src.includes('node_modules') && !src.endsWith('/.env') && !src.endsWith('.env.local'),
  })

  // Mirror packages/cli/__tests__/integration/build-start-smoke.integration.test.ts:136-150
  const demoNm = join(DEMO_DIR, 'node_modules')
  if (existsSync(demoNm)) {
    try {
      symlinkSync(demoNm, join(projectDir, 'node_modules'), 'dir')
    } catch {
      cpSync(demoNm, join(projectDir, 'node_modules'), { recursive: true })
    }
  }

  const port = 19500 + Math.floor(Math.random() * 500)

  const scrubbedEnvLines = [
    `DATABASE_URL=${dbUrl}`,
    'JWT_SECRET=test-secret-for-runtime-smoke',
    'COOKIE_SECRET=test-cookie-secret-for-runtime-smoke',
    `PORT=${port}`,
    'APP_ENV=prod',
    'NODE_ENV=production',
    '',
  ]
  writeFileSync(join(projectDir, '.env'), scrubbedEnvLines.join('\n'))

  const runEnv: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    DATABASE_URL: dbUrl,
    JWT_SECRET: 'test-secret-for-runtime-smoke',
    COOKIE_SECRET: 'test-cookie-secret-for-runtime-smoke',
    APP_ENV: 'prod',
    NODE_ENV: 'production',
  }

  execFileSync('pnpm', ['exec', 'manta', 'build', '--preset', 'node'], {
    cwd: projectDir,
    stdio: 'inherit',
    env: runEnv,
  })

  const startEnv: Record<string, string> = { ...runEnv, PORT: String(port), NITRO_PORT: String(port) }

  const child = spawn('pnpm', ['exec', 'manta', 'start'], {
    cwd: projectDir,
    env: startEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdoutBuffer = ''
  let stderrBuffer = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString()
  })

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      rejectPromise(
        new Error(`Timed out waiting for "${READY_SIGNAL}" (60s).\nstdout:\n${stdoutBuffer}\nstderr:\n${stderrBuffer}`),
      )
    }, 60_000)

    const check = () => {
      if (stdoutBuffer.includes(READY_SIGNAL) || stderrBuffer.includes(READY_SIGNAL)) {
        clearTimeout(timer)
        resolvePromise()
      }
    }

    child.stdout?.on('data', check)
    child.stderr?.on('data', check)
    child.on('exit', (code) => {
      clearTimeout(timer)
      rejectPromise(
        new Error(
          `manta start exited (code ${code}) before "${READY_SIGNAL}".\nstdout:\n${stdoutBuffer}\nstderr:\n${stderrBuffer}`,
        ),
      )
    })
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
  writeFileSync(
    STATE_PATH,
    JSON.stringify(
      {
        skipped: false,
        port,
        pid: child.pid,
        tempDir,
        dbName,
        baseUrl,
      },
      null,
      2,
    ),
  )

  process.env.MANTA_RUNTIME_BASE_URL = baseUrl

  child.unref()
}

export default globalSetup
