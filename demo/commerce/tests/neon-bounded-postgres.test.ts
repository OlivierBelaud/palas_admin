import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
// biome-ignore lint/style/noRestrictedImports: exercise the installed runtime patch, outside app bootstrap
import { instantiateServiceDescriptor } from '@mantajs/core'
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const packageRoot = dirname(createRequire(import.meta.url).resolve('@mantajs/adapter-database-pg'))
const { DrizzleRepository } = await import(pathToFileURL(join(packageRoot, 'repository.js')).href)
const url = process.env.PALAS_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
suite('installed Palas patches bound PostgreSQL reads', () => {
  const pool = postgres(url || 'postgresql://localhost/unused', {
    max: 1,
    onnotice: () => {},
    connection: { search_path: 'neon_bounded_test' },
  })
  const adapter = { getPool: () => pool }
  beforeAll(async () => {
    if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Isolated local test database required')
    await pool`DROP SCHEMA IF EXISTS neon_bounded_test CASCADE`
    await pool`CREATE SCHEMA neon_bounded_test`
  })
  afterAll(async () => {
    await pool.end()
  })
  it('bounds entity pages in SQL and counts without returning payload rows', async () => {
    const pool = adapter.getPool()
    await pool`CREATE TABLE bounded_read_probe (
      id TEXT PRIMARY KEY, status TEXT, payload TEXT,
      created_at TIMESTAMPTZ DEFAULT now(), deleted_at TIMESTAMPTZ
    )`
    await pool`INSERT INTO bounded_read_probe (id,status,payload,deleted_at)
      SELECT i::text, CASE WHEN i % 2 = 0 THEN 'active' ELSE 'inactive' END,
        repeat('x',1000), CASE WHEN i > 9900 THEN now() ELSE NULL END
      FROM generate_series(1,10000) i`
    const table = pgTable('bounded_read_probe', {
      id: text('id').primaryKey(),
      status: text('status'),
      payload: text('payload'),
      created_at: timestamp('created_at'),
      deleted_at: timestamp('deleted_at'),
    })
    const queries: Array<{ sql: string; params: unknown[] }> = []
    const client = drizzle(pool, {
      logger: {
        logQuery(sql, params) {
          queries.push({ sql, params })
        },
      },
    })
    const repo = new DrizzleRepository({ db: client as never, table, entityName: 'Probe' })
    const service = instantiateServiceDescriptor(
      { entity: { name: 'Probe', schema: { status: {}, virtual_status: {} } }, factory: () => ({}) } as never,
      repo,
    )
    const page = service.__queryPage as (opts: unknown) => Promise<[unknown[], number]>
    const [rows, total] = await page({ where: { status: 'active' }, limit: 7, offset: 2, order: { id: 'ASC' } })
    expect(rows).toHaveLength(7)
    expect(total).toBe(4950)
    expect(rows.map((row) => (row as { id: string }).id)).toEqual([
      '1000',
      '1002',
      '1004',
      '1006',
      '1008',
      '1010',
      '1012',
    ])
    expect(queries.filter((q) => !q.sql.includes('count(*)::int')).every((q) => q.sql.includes('limit'))).toBe(true)
    expect(queries.some((q) => q.params.includes(7) && q.params.includes(2))).toBe(true)
    queries.length = 0
    const [countRows, count] = await page({ limit: 0, offset: 0 })
    expect(countRows).toEqual([])
    expect(count).toBe(9900)
    expect(queries.some((q) => q.sql.includes('count(*)::int'))).toBe(true)
    expect(
      queries
        .filter((q) => !q.sql.includes('count(*)::int'))
        .every((q) => q.sql.includes('limit') && q.params.includes(0)),
    ).toBe(true)
    expect(queries).toHaveLength(1)
    queries.length = 0
    const [sample, sampleCount] = await page({ fields: ['id'], limit: 1, offset: 0, count: false })
    expect(sample).toHaveLength(1)
    expect(Object.keys(sample[0] as object)).toEqual(['id'])
    expect(sampleCount).toBeNull()
    expect(queries).toHaveLength(1)
    expect(queries[0].sql).not.toContain('count(')
    expect(queries[0].sql).not.toContain('payload')
    expect(queries[0].sql).toContain('limit')
    queries.length = 0
    const [projected] = await page({ fields: ['id'], limit: 2, offset: 0 })
    expect(projected).toHaveLength(2)
    expect(Object.keys(projected[0] as object)).toEqual(['id'])
    expect(queries.every((query) => !query.sql.includes('payload'))).toBe(true)
    queries.length = 0
    await expect(page({ limit: -1, offset: 0 })).rejects.toThrow('Invalid bounded query')
    expect(queries).toEqual([])
    await expect(page({ where: { typo: 'active' }, limit: 1, offset: 0 })).rejects.toThrow('Unknown filter field')
    await expect(page({ where: { status: { $unknown: 'active' } }, limit: 1, offset: 0 })).rejects.toThrow(
      'Unsupported filter',
    )
    expect(queries).toEqual([])
    await expect(page({ where: { virtual_status: 'active' }, limit: 1, offset: 0 })).rejects.toThrow(
      'Unknown storage filter column',
    )
    expect(queries).toEqual([])
  })
  it('executes literal case-insensitive search in SQL before pagination', async () => {
    const pool = adapter.getPool()
    await pool`CREATE TABLE bounded_search_probe (id TEXT PRIMARY KEY,title TEXT,description TEXT,sku TEXT,created_at TIMESTAMPTZ DEFAULT now(),deleted_at TIMESTAMPTZ)`
    await pool`INSERT INTO bounded_search_probe (id,title,description,sku) VALUES ('a','Blue Shoe','',''),('b','Shoe 50%','',''),('c','Other','SHOE','')`
    await pool`INSERT INTO bounded_search_probe (id,title,deleted_at) VALUES ('d','shoe',now())`
    const table = pgTable('bounded_search_probe', {
      id: text('id').primaryKey(),
      title: text('title'),
      description: text('description'),
      sku: text('sku'),
      created_at: timestamp('created_at'),
      deleted_at: timestamp('deleted_at'),
    })
    const queries: Array<{ sql: string; params: unknown[] }> = []
    const repo = new DrizzleRepository({
      db: drizzle(pool, {
        logger: {
          logQuery(sql, params) {
            queries.push({ sql, params })
          },
        },
      }) as never,
      table,
      entityName: 'Search',
    })
    const [rows, count] = await repo.findAndCount({
      search: 'shoe',
      fields: ['id'],
      limit: 1,
      offset: 1,
      order: { id: 'ASC' },
    })
    expect(rows).toEqual([{ id: 'b' }])
    expect(count).toBe(3)
    expect(queries.some((q) => q.sql.includes('ILIKE') && q.sql.includes('limit'))).toBe(true)
    const [literal, literalCount] = await repo.findAndCount({ search: '50%', fields: ['id'], limit: 10 })
    expect(literal).toEqual([{ id: 'b' }])
    expect(literalCount).toBe(1)
  })
})
