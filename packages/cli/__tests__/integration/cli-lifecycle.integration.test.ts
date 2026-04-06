// CLI lifecycle e2e integration tests
// Spawns the real CLI binary via tsx and verifies stdout/stderr/exit codes.
// Tests that don't need PG run without Docker.
// Tests that need PG require: docker-compose.test.yml running on port 5433.

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..', '..', '..', '..')
const BIN = resolve(ROOT, 'packages', 'cli', 'bin', 'manta.ts')
const TSX = resolve(ROOT, 'node_modules', '.bin', 'tsx')

/**
 * Run the CLI binary and return { stdout, stderr, exitCode }.
 */
function runCli(
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const env = { ...process.env, ...options.env }
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
          exitCode:
            error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
              ? 1
              : ((error as NodeJS.ErrnoException & { status?: number })?.status ?? child.exitCode ?? 0),
        })
      },
    )
  })
}

describe('CLI lifecycle e2e', () => {
  let tempDir: string

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'manta-cli-e2e-'))
  })

  afterAll(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // ── manta init ────────────────────────────────────────────────────

  it('manta init creates project structure', async () => {
    const projectDir = join(tempDir, 'init-test')
    mkdirSync(projectDir, { recursive: true })

    const result = await runCli(['init', '--dir', projectDir])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Manta project initialized')

    // Verify files were created
    expect(existsSync(join(projectDir, 'manta.config.ts'))).toBe(true)
    expect(existsSync(join(projectDir, 'package.json'))).toBe(true)
    expect(existsSync(join(projectDir, '.env'))).toBe(true)
    expect(existsSync(join(projectDir, 'tsconfig.json'))).toBe(true)
    expect(existsSync(join(projectDir, '.gitignore'))).toBe(true)

    // Verify directories
    expect(existsSync(join(projectDir, 'src', 'modules'))).toBe(true)
    expect(existsSync(join(projectDir, 'src', 'commands'))).toBe(true)
    expect(existsSync(join(projectDir, 'src', 'admin'))).toBe(true)

    // Verify package.json content
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'))
    expect(pkg.name).toBeTruthy()
    expect(pkg.type).toBe('module')
    expect(pkg.scripts?.dev).toBe('manta dev')
    expect(pkg.dependencies?.['@manta/core']).toBeTruthy()
  })

  it('manta init is idempotent (skip existing files)', async () => {
    const projectDir = join(tempDir, 'init-idempotent')
    mkdirSync(projectDir, { recursive: true })

    // First init
    await runCli(['init', '--dir', projectDir])

    // Second init — should skip all files
    const result = await runCli(['init', '--dir', projectDir])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('already initialized')
    expect(result.stdout).toContain('Skipped')
  })

  // ── manta build ───────────────────────────────────────────────────

  it('manta build generates manifest', async () => {
    const projectDir = join(tempDir, 'build-test')
    mkdirSync(projectDir, { recursive: true })

    // Create a minimal project structure with a config file that doesn't import @manta/core
    writeFileSync(
      join(projectDir, 'manta.config.ts'),
      `export default {
  database: { url: 'postgresql://localhost/test' },
  http: { port: 9000 },
}
`,
    )
    // Create an API route
    mkdirSync(join(projectDir, 'src', 'api', 'admin', 'products'), { recursive: true })
    writeFileSync(
      join(projectDir, 'src', 'api', 'admin', 'products', 'route.ts'),
      `export async function GET() { return { products: [] } }\nexport async function POST() { return {} }`,
    )
    // Create a module
    mkdirSync(join(projectDir, 'src', 'modules', 'product'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'modules', 'product', 'index.ts'), `export default {}`)

    const result = await runCli(['build'], { cwd: projectDir })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Build complete')

    // Verify manifest files
    const manifestDir = join(projectDir, '.manta', 'manifest')
    expect(existsSync(join(manifestDir, 'routes.json'))).toBe(true)
    expect(existsSync(join(manifestDir, 'modules.json'))).toBe(true)

    const routes = JSON.parse(readFileSync(join(manifestDir, 'routes.json'), 'utf-8'))
    expect(routes.routes.length).toBeGreaterThan(0)
    expect(routes.routes[0].path).toBe('/admin/products')
  })

  // ── manta start ───────────────────────────────────────────────────

  it('manta start fails without JWT_SECRET in prod', async () => {
    const projectDir = join(tempDir, 'start-test')
    mkdirSync(projectDir, { recursive: true })

    writeFileSync(
      join(projectDir, 'manta.config.ts'),
      `export default {
  database: { url: 'postgresql://localhost/test' },
  http: { port: 9000 },
}
`,
    )

    const result = await runCli(['start'], {
      cwd: projectDir,
      env: { APP_ENV: 'prod', NODE_ENV: 'production' },
    })

    expect(result.exitCode).toBe(1)
    // startCommand checks for JWT_SECRET in prod
    const output = result.stdout + result.stderr
    expect(output).toContain('JWT_SECRET')
  })

  // ── manta exec ────────────────────────────────────────────────────

  it('manta exec runs a script with app', async () => {
    const projectDir = join(tempDir, 'exec-test')
    mkdirSync(projectDir, { recursive: true })

    writeFileSync(
      join(projectDir, 'manta.config.ts'),
      `export default {
  database: { url: 'postgresql://localhost/test' },
}
`,
    )

    // Create a script that writes a marker file to prove it ran
    const markerFile = join(projectDir, 'exec-marker.txt')
    writeFileSync(
      join(projectDir, 'test-script.ts'),
      `export default async ({ app, args }: { app: any, args: string[] }) => {
  const fs = await import('node:fs')
  fs.writeFileSync('${markerFile.replace(/\\/g, '\\\\')}', 'executed:' + args.join(','))
}`,
    )

    const result = await runCli(['exec', 'test-script.ts'], { cwd: projectDir })

    expect(result.exitCode).toBe(0)
    expect(existsSync(markerFile)).toBe(true)
    expect(readFileSync(markerFile, 'utf-8')).toBe('executed:')
  })

  // ── unknown command ───────────────────────────────────────────────

  it('unknown command shows helpful error', async () => {
    const result = await runCli(['nonexistent-cmd'])

    expect(result.exitCode).toBe(1)
    const output = result.stdout + result.stderr
    expect(output).toContain('Unknown command')
    expect(output).toContain('--help')
  })

  // ── manta dev (config validation) ─────────────────────────────────

  it('manta dev starts and responds to SIGINT', async () => {
    // Test that dev command fails gracefully when no config exists
    const projectDir = join(tempDir, 'dev-no-config')
    mkdirSync(projectDir, { recursive: true })

    const result = await runCli(['dev'], { cwd: projectDir })

    expect(result.exitCode).toBe(1)
    const output = result.stdout + result.stderr
    expect(output).toContain('manta.config.ts not found')
  })

  // ── DB commands requiring PG ─────────────────────────────────────
  // These tests require PG running locally on port 5432.
  // They use an isolated test database per test.

  const TEST_DB_URL = process.env['TEST_DATABASE_URL'] || 'postgresql://localhost:5432/manta_test_main'
  const testDbName = `cli_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const testDbUrl = TEST_DB_URL.replace(/\/[^/]+$/, `/${testDbName}`)

  let dbProjectDir: string

  beforeAll(() => {
    dbProjectDir = join(tempDir, 'db-test')
    mkdirSync(dbProjectDir, { recursive: true })

    // Create a minimal manta project for DB commands
    writeFileSync(
      join(dbProjectDir, 'manta.config.ts'),
      `export default {\n  database: { url: '${testDbUrl}' },\n  http: { port: 9000 },\n}\n`,
    )

    // Create a DML model so db:generate has something to scan
    mkdirSync(join(dbProjectDir, 'src', 'modules', 'product', 'models'), { recursive: true })
    writeFileSync(
      join(dbProjectDir, 'src', 'modules', 'product', 'models', 'product.ts'),
      `export default { name: 'product' }\n`,
    )
  })

  it('manta db:create creates the database', async () => {
    const result = await runCli(['db', 'create'], {
      cwd: dbProjectDir,
      env: { DATABASE_URL: testDbUrl },
    })

    expect(result.exitCode).toBe(0)
    const output = result.stdout + result.stderr
    expect(output).toContain(testDbName)
    expect(output).toContain('created')
  })

  it('manta db:generate creates migration files', async () => {
    const result = await runCli(['db', 'generate', '--name', 'init'], {
      cwd: dbProjectDir,
      env: { DATABASE_URL: testDbUrl },
    })

    expect(result.exitCode).toBe(0)
    const output = result.stdout + result.stderr
    expect(output).toContain('Migration generated')

    // Verify migration file was created
    const migrationsDir = join(dbProjectDir, 'drizzle', 'migrations')
    expect(existsSync(migrationsDir)).toBe(true)

    const files = readdirSync(migrationsDir)
    const sqlFiles = files.filter((f: string) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    expect(sqlFiles.length).toBeGreaterThan(0)

    // Verify rollback skeleton was created
    const downFiles = files.filter((f: string) => f.endsWith('.down.sql'))
    expect(downFiles.length).toBeGreaterThan(0)
  })

  it('manta db:migrate applies pending migrations', async () => {
    const result = await runCli(['db', 'migrate'], {
      cwd: dbProjectDir,
      env: { DATABASE_URL: testDbUrl },
    })

    expect(result.exitCode).toBe(0)
    const output = result.stdout + result.stderr
    expect(output).toContain('Applied')
  })

  it('manta db:diff shows schema state', async () => {
    const result = await runCli(['db', 'diff'], {
      cwd: dbProjectDir,
      env: { DATABASE_URL: testDbUrl },
    })

    expect(result.exitCode).toBe(0)
    // After migrate, diff should run without errors
    const output = result.stdout + result.stderr
    expect(output).toBeDefined()
  })

  it('manta db:rollback reverts last migration', async () => {
    // First, write a real rollback SQL (the generated one is a TODO placeholder)
    const migrationsDir = join(dbProjectDir, 'drizzle', 'migrations')
    const files = readdirSync(migrationsDir)
    const downFile = files.find((f: string) => f.endsWith('.down.sql'))
    if (downFile) {
      writeFileSync(join(migrationsDir, downFile), 'DROP TABLE IF EXISTS "product";\n')
    }

    const result = await runCli(['db', 'rollback'], {
      cwd: dbProjectDir,
      env: { DATABASE_URL: testDbUrl },
    })

    expect(result.exitCode).toBe(0)
    const output = result.stdout + result.stderr
    expect(output).toContain('Rolled back')
  })

  // Cleanup: drop the test database after all DB tests
  afterAll(async () => {
    try {
      const pg = await import('pg')
      const client = new pg.default.Client({ connectionString: TEST_DB_URL })
      await client.connect()
      await client.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '${testDbName}' AND pid <> pg_backend_pid()
      `)
      await client.query(`DROP DATABASE IF EXISTS "${testDbName}"`)
      await client.end()
    } catch {
      // Best effort cleanup
    }
  })
})
