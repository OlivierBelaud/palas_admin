import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { waitForPg } from '@mantajs/test-utils/pg'

if (!process.env.TEST_DATABASE_URL?.trim()) {
  throw new Error('TEST_DATABASE_URL is required for the mandatory migration gate')
}

const demoDir = resolve('demo/commerce')
const migrationsDir = resolve(demoDir, 'drizzle/migrations')
const bootstrapSchema = resolve(demoDir, 'scripts/bootstrap-ci-schema.ts')
const manifest = JSON.parse(readFileSync(resolve(migrationsDir, 'ci-baseline.json'), 'utf8'))
const migrationFiles = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql') && !name.endsWith('.down.sql')).sort()
const classifiedFiles = [...manifest.baseline, ...manifest.apply].sort()
if (new Set(classifiedFiles).size !== classifiedFiles.length) {
  throw new Error('Migration baseline contains duplicate classifications')
}
if (!isDeepStrictEqual(migrationFiles, classifiedFiles)) {
  const unclassified = migrationFiles.filter((name) => !classifiedFiles.includes(name))
  const stale = classifiedFiles.filter((name) => !migrationFiles.includes(name))
  throw new Error(`Migration baseline drift (unclassified: ${unclassified.join(', ') || 'none'}; stale: ${stale.join(', ') || 'none'})`)
}

await waitForPg()
const database = await createMigrationDatabase(
  process.env.TEST_DATABASE_URL,
  `admin_migrations_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
)
const mantaBin = resolve(demoDir, 'node_modules', '.bin', process.platform === 'win32' ? 'manta.cmd' : 'manta')

try {
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    CI: process.env.CI ?? '',
    TMPDIR: process.env.TMPDIR ?? '',
    DATABASE_URL: database.url,
    JWT_SECRET: 'migration-gate-jwt-secret',
    COOKIE_SECRET: 'migration-gate-cookie-secret',
    RESEND_API_KEY: 're_migration_gate_no_delivery',
    UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:1',
    UPSTASH_REDIS_REST_TOKEN: 'migration-gate-token',
    QSTASH_TOKEN: 'migration-gate-qstash-token',
    QSTASH_CURRENT_SIGNING_KEY: 'migration-gate-current-key',
    QSTASH_NEXT_SIGNING_KEY: 'migration-gate-next-key',
    BLOB_READ_WRITE_TOKEN: 'migration-gate-blob-token',
    SHOPIFY_CATALOG_WRITES_ENABLED: 'false',
    APP_ENV: 'test',
    NODE_ENV: 'test',
  }
  execFileSync(process.execPath, [bootstrapSchema], {
    cwd: demoDir,
    env,
    stdio: 'inherit',
  })
  const require = createRequire(resolve(demoDir, 'package.json'))
  const postgres = require('postgres')
  const sql = postgres(database.url, { max: 1, prepare: false })
  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _manta_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_sql TEXT,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    for (const name of manifest.baseline) {
      const source = readFileSync(resolve(migrationsDir, name), 'utf8')
      const migrationName = name.replace(/\.sql$/, '')
      await sql.unsafe(
        'INSERT INTO _manta_migrations (name, applied_sql) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [migrationName, source],
      )
    }
  } finally {
    await sql.end()
  }
  const runMigrationPass = () =>
    execFileSync(mantaBin, ['db', 'migrate', '--all-or-nothing', '--force', '--json'], {
      cwd: demoDir,
      env,
      encoding: 'utf8',
    })
  process.stdout.write(runMigrationPass())

  const verificationSql = postgres(database.url, { max: 1, prepare: false })
  try {
    const appliedRows = await verificationSql.unsafe('SELECT name FROM _manta_migrations ORDER BY name')
    const expectedNames = classifiedFiles.map((name) => name.replace(/\.sql$/, '')).sort()
    const appliedNames = appliedRows.map((row) => row.name).sort()
    if (!isDeepStrictEqual(appliedNames, expectedNames)) {
      throw new Error(`Migration tracker drift (expected ${expectedNames.length} entries, found ${appliedNames.length})`)
    }
  } finally {
    await verificationSql.end()
  }

  const secondPassOutput = runMigrationPass()
  process.stdout.write(secondPassOutput)
  if (!secondPassOutput.includes('No pending migrations.')) {
    throw new Error('Second migration pass succeeded without proving that no migrations were pending')
  }
  console.log(
    `Migration gate: fresh bootstrap, ${manifest.baseline.length} baseline migrations, ${manifest.apply.length} replayed up migrations, and an empty second pass succeeded`,
  )
} finally {
  await database.cleanup()
}

async function createMigrationDatabase(bootstrapUrl, dbName) {
  const { default: pg } = await import('pg')
  const roleName = `${dbName}_role`
  const password = randomUUID()
  const bootstrap = new pg.Client({ connectionString: bootstrapUrl })
  await bootstrap.connect()
  try {
    await bootstrap.query(`DROP DATABASE IF EXISTS "${dbName}"`)
    await bootstrap.query(`DROP ROLE IF EXISTS "${roleName}"`)
    await bootstrap.query(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${password}'`)
    await bootstrap.query(`CREATE DATABASE "${dbName}" OWNER "${roleName}"`)
  } finally {
    await bootstrap.end()
  }

  // @mantajs/test-utils beta.12 replaces the final slash-delimited URL
  // segment and corrupts libpq socket URLs. Give the application adapters a
  // dedicated TCP role while keeping the bootstrap connection on the local
  // socket. Remove this compatibility path when OLI-393 is released.
  const databaseUrl = new URL(bootstrapUrl)
  if (!databaseUrl.hostname || databaseUrl.searchParams.get('host')?.startsWith('/')) {
    databaseUrl.hostname = '127.0.0.1'
  }
  databaseUrl.searchParams.delete('host')
  databaseUrl.username = roleName
  databaseUrl.password = password
  databaseUrl.pathname = `/${dbName}`

  return {
    url: databaseUrl.toString(),
    cleanup: async () => {
      const client = new pg.Client({ connectionString: bootstrapUrl })
      await client.connect()
      try {
        await client.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
          [dbName],
        )
        await client.query(`DROP DATABASE IF EXISTS "${dbName}"`)
        await client.query(`DROP ROLE IF EXISTS "${roleName}"`)
      } finally {
        await client.end()
      }
    },
  }
}
