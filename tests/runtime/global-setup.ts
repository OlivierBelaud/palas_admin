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
const MANTA_BIN = resolve(DEMO_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'manta.cmd' : 'manta')
const READY_SIGNAL = 'Listening on:'

async function globalSetup(): Promise<void> {
  if (!process.env.TEST_DATABASE_URL) {
    writeFileSync(STATE_PATH, JSON.stringify({ skipped: true, reason: 'no TEST_DATABASE_URL' }, null, 2))
    return
  }

  const { createTestDatabase, waitForPg } = await import('@mantajs/test-utils/pg')

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
  const cachePort = 20500 + Math.floor(Math.random() * 500)
  const cacheUrl = `http://127.0.0.1:${cachePort}`

  const scrubbedEnvLines = [
    `DATABASE_URL=${dbUrl}`,
    'JWT_SECRET=test-secret-for-runtime-smoke',
    'COOKIE_SECRET=test-cookie-secret-for-runtime-smoke',
    `PORT=${port}`,
    'MANTA_RUNTIME_SMOKE=1',
    'RESEND_API_KEY=re_runtime_smoke_no_delivery',
    'SHOPIFY_CATALOG_WRITES_ENABLED=false',
    `UPSTASH_REDIS_REST_URL=${cacheUrl}`,
    'UPSTASH_REDIS_REST_TOKEN=runtime-smoke-token',
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
    MANTA_RUNTIME_SMOKE: '1',
    RESEND_API_KEY: 're_runtime_smoke_no_delivery',
    SHOPIFY_CATALOG_WRITES_ENABLED: 'false',
    UPSTASH_REDIS_REST_URL: cacheUrl,
    UPSTASH_REDIS_REST_TOKEN: 'runtime-smoke-token',
    APP_ENV: 'prod',
    NODE_ENV: 'production',
  }
  process.env.DATABASE_URL = dbUrl
  process.env.JWT_SECRET = runEnv.JWT_SECRET
  process.env.NODE_ENV = 'production'
  process.env.SHOPIFY_CATALOG_WRITES_ENABLED = 'false'

  const cacheScript = join(projectDir, '.runtime-cache.mjs')
  writeFileSync(
    cacheScript,
    [
      "import { createServer } from 'node:http'",
      'const store = new Map()',
      'function execute(command) {',
      "  const [rawName, key, value] = command",
      "  const name = String(rawName ?? '').toLowerCase()",
      "  if (name === 'ping') return 'PONG'",
      "  if (name === 'get') return store.get(String(key)) ?? null",
      "  if (name === 'set') { store.set(String(key), value); return 'OK' }",
      "  if (name === 'del') return store.delete(String(key)) ? 1 : 0",
      "  if (name === 'flushdb') { store.clear(); return 'OK' }",
      "  throw new Error(`Unsupported runtime cache command: ${name}`)",
      '}',
      'const server = createServer((request, response) => {',
      "  let body = ''",
      "  request.setEncoding('utf8')",
      "  request.on('data', (chunk) => { body += chunk })",
      "  request.on('end', () => {",
      '    try {',
      "      const payload = body ? JSON.parse(body) : ['PING']",
      '      const result = Array.isArray(payload[0])',
      '        ? payload.map((command) => ({ result: execute(command) }))',
      '        : { result: execute(payload) }',
      "      response.writeHead(200, { 'content-type': 'application/json' })",
      '      response.end(JSON.stringify(result))',
      '    } catch (error) {',
      "      response.writeHead(400, { 'content-type': 'application/json' })",
      '      response.end(JSON.stringify({ error: String(error) }))',
      '    }',
      '  })',
      '})',
      `server.listen(${cachePort}, '127.0.0.1')`,
      '',
    ].join('\n'),
  )
  const cacheChild = spawn(process.execPath, [cacheScript], {
    cwd: projectDir,
    env: runEnv,
    stdio: 'ignore',
  })

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

  // Reuse the binary installed from the immutable root lockfile. Running
  // `pnpm exec` inside the copied fixture makes pnpm treat it as a standalone
  // project and can trigger an unpinned install through the node_modules link.
  //
  // Production mode deliberately never auto-creates model tables. Materialize
  // the current DML schema once through the framework's dev bootstrap, then
  // exercise the compiled production server against that isolated schema.
  const bootstrapScript = join(projectDir, '.runtime-bootstrap.mjs')
  writeFileSync(
    bootstrapScript,
    [
      "import { bootstrapApp } from '@mantajs/cli/bootstrap'",
      "import { loadConfig } from '@mantajs/cli/config'",
      "import { createJiti } from '@mantajs/cli/jiti'",
      'const cwd = process.cwd()',
      'const jiti = createJiti(cwd)',
      'const importFn = (path) => jiti.import(path)',
      'const config = await loadConfig(cwd, { importFn })',
      "const bootstrapped = await bootstrapApp({ config, cwd, mode: 'dev', importFn })",
      'await bootstrapped.shutdown()',
      '',
    ].join('\n'),
  )
  execFileSync(process.execPath, [bootstrapScript], {
    cwd: projectDir,
    stdio: 'inherit',
    env: runEnv,
  })

  const catalogMigrations = [
    '20260716120000_catalog_taxonomy.sql',
    '20260716133000_catalog_category_presentation.sql',
    '20260716150000_catalog_shopify_mirrors.sql',
    '20260717100000_catalog_content.sql',
    '20260717113000_catalog_menu_images.sql',
    '20260720170000_catalog_publication_governance.sql',
  ]
  const catalogBootstrapScript = join(projectDir, '.runtime-catalog-bootstrap.mjs')
  writeFileSync(
    catalogBootstrapScript,
    [
      "import { readFile } from 'node:fs/promises'",
      "import postgres from 'postgres'",
      'const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false })',
      `const migrations = ${JSON.stringify(catalogMigrations)}`,
      'try {',
      '  for (const migration of migrations) {',
      "    const source = await readFile(new URL(`./drizzle/migrations/${migration}`, import.meta.url), 'utf8')",
      '    await sql.unsafe(source)',
      '  }',
      '} finally {',
      '  await sql.end()',
      '}',
      '',
    ].join('\n'),
  )
  execFileSync(process.execPath, [catalogBootstrapScript], {
    cwd: projectDir,
    stdio: 'inherit',
    env: runEnv,
  })

  execFileSync(MANTA_BIN, ['build', '--preset', 'node', '--no-migrate'], {
    cwd: projectDir,
    stdio: 'inherit',
    env: runEnv,
  })

  const startEnv: Record<string, string> = { ...runEnv, PORT: String(port), NITRO_PORT: String(port) }

  const child = spawn(MANTA_BIN, ['start', '--port', String(port)], {
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
        cachePid: cacheChild.pid,
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
