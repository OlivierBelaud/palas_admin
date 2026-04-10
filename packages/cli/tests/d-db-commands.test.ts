// Section D — Database commands (generate, migrate, rollback, diff, create)
// Tests: D-01 → D-20

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractDbName } from '../src/commands/db/create'
import { compareSchemas } from '../src/commands/db/diff'
import { detectDangerousChanges, detectRenames, isNonInteractive, scanDmlModels } from '../src/commands/db/generate'
import { detectConcurrentIndex, findPendingMigrations } from '../src/commands/db/migrate'
import { validateRollbackFile } from '../src/commands/db/rollback'

const TMP = resolve(__dirname, '__tmp_db_test__')

function setup() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true })
}

// -------------------------------------------------------------------
// D-01 → D-07 — db:generate
// -------------------------------------------------------------------
describe('D — db:generate', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('D-01 — scanDmlModels finds model files in src/modules/**/models/', () => {
    mkdirSync(join(TMP, 'src/modules/product/models'), { recursive: true })
    writeFileSync(join(TMP, 'src/modules/product/models/product.ts'), 'export default {}')
    mkdirSync(join(TMP, 'src/modules/order/models'), { recursive: true })
    writeFileSync(join(TMP, 'src/modules/order/models/order.ts'), 'export default {}')

    const result = scanDmlModels(TMP)
    expect(result.entities).toHaveLength(2)
    expect(result.entities.map((e) => e.name)).toContain('product')
    expect(result.entities.map((e) => e.name)).toContain('order')
  })

  it('D-02 — scanDmlModels returns empty when no modules dir', () => {
    const result = scanDmlModels(TMP)
    expect(result.entities).toHaveLength(0)
  })

  it('D-03 — detectRenames finds candidate pairs by same table + type', () => {
    const dropped = [{ table: 'products', column: 'title', type: 'text' }]
    const added = [{ table: 'products', column: 'name', type: 'text' }]

    const renames = detectRenames(dropped, added)
    expect(renames).toHaveLength(1)
    expect(renames[0]).toEqual({
      table: 'products',
      from: 'title',
      to: 'name',
      type: 'text',
    })
  })

  it('D-04 — detectRenames does NOT match different types', () => {
    const dropped = [{ table: 'products', column: 'price', type: 'integer' }]
    const added = [{ table: 'products', column: 'amount', type: 'text' }]

    const renames = detectRenames(dropped, added)
    expect(renames).toHaveLength(0)
  })

  it('D-05 — detectRenames does NOT match different tables', () => {
    const dropped = [{ table: 'products', column: 'title', type: 'text' }]
    const added = [{ table: 'orders', column: 'name', type: 'text' }]

    const renames = detectRenames(dropped, added)
    expect(renames).toHaveLength(0)
  })

  it('D-06 — detectRenames sorts candidates alphabetically by dropped column', () => {
    const dropped = [
      { table: 'products', column: 'description', type: 'text' },
      { table: 'products', column: 'title', type: 'text' },
    ]
    const added = [
      { table: 'products', column: 'summary', type: 'text' },
      { table: 'products', column: 'name', type: 'text' },
    ]

    const renames = detectRenames(dropped, added)
    // Should be sorted by 'from' field: description before title
    expect(renames[0]!.from).toBe('description')
  })

  it('D-07 — isNonInteractive returns true when CI=true', () => {
    const orig = process.env.CI
    process.env.CI = 'true'
    expect(isNonInteractive()).toBe(true)
    if (orig !== undefined) process.env.CI = orig
    else delete process.env.CI
  })

  it('D-08 — isNonInteractive returns true when MANTA_NON_INTERACTIVE=true', () => {
    const orig = process.env.MANTA_NON_INTERACTIVE
    process.env.MANTA_NON_INTERACTIVE = 'true'
    expect(isNonInteractive()).toBe(true)
    if (orig !== undefined) process.env.MANTA_NON_INTERACTIVE = orig
    else delete process.env.MANTA_NON_INTERACTIVE
  })

  it('D-09 — detectDangerousChanges finds DROP COLUMN', () => {
    const sql = 'ALTER TABLE products\n  DROP COLUMN legacy_sku;'
    const warnings = detectDangerousChanges(sql)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some((w) => w.includes('DROP COLUMN'))).toBe(true)
  })

  it('D-10 — detectDangerousChanges finds DROP TABLE', () => {
    const sql = 'DROP TABLE old_products;'
    const warnings = detectDangerousChanges(sql)
    expect(warnings.length).toBeGreaterThan(0)
  })
})

// -------------------------------------------------------------------
// D-11 → D-14 — db:migrate
// -------------------------------------------------------------------
describe('D — db:migrate', () => {
  it('D-11 — detectConcurrentIndex detects CREATE INDEX CONCURRENTLY', () => {
    const sql = 'CREATE INDEX CONCURRENTLY idx_title ON products(title);'
    expect(detectConcurrentIndex(sql)).toBe(true)
  })

  it('D-12 — detectConcurrentIndex returns false for normal CREATE INDEX', () => {
    const sql = 'CREATE INDEX idx_title ON products(title);'
    expect(detectConcurrentIndex(sql)).toBe(false)
  })

  it('D-13 — findPendingMigrations returns migrations not in tracking', () => {
    const fs = ['0001_init.sql', '0002_add_status.sql', '0003_add_price.sql']
    const applied = ['0001_init.sql']
    const pending = findPendingMigrations(fs, applied)
    expect(pending).toEqual(['0002_add_status.sql', '0003_add_price.sql'])
  })

  it('D-14 — findPendingMigrations returns empty when all applied', () => {
    const fs = ['0001_init.sql']
    const applied = ['0001_init.sql']
    const pending = findPendingMigrations(fs, applied)
    expect(pending).toHaveLength(0)
  })
})

// -------------------------------------------------------------------
// D-15 → D-17 — db:rollback
// -------------------------------------------------------------------
describe('D — db:rollback', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('D-15 — validateRollbackFile returns error if file does not exist', () => {
    const error = validateRollbackFile('drizzle/migrations/0001.down.sql', TMP)
    expect(error).not.toBeNull()
    expect(error).toContain('not found')
  })

  it('D-16 — validateRollbackFile returns error if file is just comments (skeleton)', () => {
    const filePath = 'drizzle/migrations/0001.down.sql'
    mkdirSync(join(TMP, 'drizzle/migrations'), { recursive: true })
    writeFileSync(
      join(TMP, filePath),
      '-- Rollback SQL for this migration.\n-- Revert your model and run db:generate.\n',
    )
    const error = validateRollbackFile(filePath, TMP)
    expect(error).not.toBeNull()
    expect(error).toContain('no SQL')
  })

  it('D-17 — validateRollbackFile returns null if file has real SQL', () => {
    const filePath = 'drizzle/migrations/0001.down.sql'
    mkdirSync(join(TMP, 'drizzle/migrations'), { recursive: true })
    writeFileSync(join(TMP, filePath), 'DROP TABLE products;')
    const error = validateRollbackFile(filePath, TMP)
    expect(error).toBeNull()
  })
})

// -------------------------------------------------------------------
// D-18 → D-19 — db:diff
// -------------------------------------------------------------------
describe('D — db:diff', () => {
  it('D-18 — compareSchemas finds missing tables', () => {
    const expected = [{ table: 'products', columns: ['id', 'title'] }]
    const actual: Array<{ table: string; columns: string[] }> = []

    const { diffs } = compareSchemas(expected, actual)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]!.type).toBe('missing')
    expect(diffs[0]!.entity).toBe('table')
    expect(diffs[0]!.name).toBe('products')
  })

  it('D-19 — compareSchemas finds extra tables as notifications', () => {
    const expected: Array<{ table: string; columns: string[] }> = []
    const actual = [{ table: 'legacy_data', columns: ['id'] }]

    const { notifications } = compareSchemas(expected, actual)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.type).toBe('extra')
    expect(notifications[0]!.name).toBe('legacy_data')
  })
})

// -------------------------------------------------------------------
// D-20 — db:create
// -------------------------------------------------------------------
describe('D — db:create', () => {
  it('D-20 — extractDbName extracts name from PostgreSQL URL', () => {
    expect(extractDbName('postgresql://user:pass@localhost:5432/manta_demo')).toBe('manta_demo')
    expect(extractDbName('postgresql://localhost/mydb')).toBe('mydb')
    expect(extractDbName('postgresql://localhost:5432/test?sslmode=require')).toBe('test')
  })
})
