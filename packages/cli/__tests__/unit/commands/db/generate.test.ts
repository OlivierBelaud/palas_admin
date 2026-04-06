// Section B6 — db:generate command
// Ref: CLI_SPEC §2.2, CLI_TESTS_SPEC §B6
// Tests: DML scanning, rename detection, dangerous changes, command with mocked deps

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  detectDangerousChanges,
  detectRenames,
  generateCommand,
  isNonInteractive,
  scanDmlModels,
} from '../../../../src/commands/db/generate'
import type { GenerateDeps } from '../../../../src/commands/db/types'

const TMP = resolve(__dirname, '__tmp_gen_test__')

function setup() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
}
function teardown() {
  rmSync(TMP, { recursive: true, force: true })
}

// ── Mock factories ──────────────────────────────────────────────────

function createMockDeps(overrides: Partial<GenerateDeps> = {}): GenerateDeps {
  return {
    drizzleKit: {
      generate: vi.fn().mockResolvedValue({
        migrationFile: null,
        sql: null,
      }),
    },
    migrationFs: {
      writeRollbackSkeleton: vi.fn().mockResolvedValue(undefined),
      writeDrizzleSchema: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  }
}

// ── Pure function tests ─────────────────────────────────────────────

describe('B6 — db:generate — pure functions', () => {
  beforeEach(setup)
  afterEach(teardown)

  // -------------------------------------------------------------------
  // GENERATE-01 — scans src/modules/**/models/*.ts
  // -------------------------------------------------------------------
  it('GENERATE-01 — finds model files in modules', () => {
    mkdirSync(join(TMP, 'src/modules/product/models'), { recursive: true })
    writeFileSync(join(TMP, 'src/modules/product/models/product.ts'), 'export default {}')
    mkdirSync(join(TMP, 'src/modules/order/models'), { recursive: true })
    writeFileSync(join(TMP, 'src/modules/order/models/order.ts'), 'export default {}')

    const result = scanDmlModels(TMP)
    expect(result.entities).toHaveLength(2)
    expect(result.entities.map((e) => e.name)).toContain('product')
    expect(result.entities.map((e) => e.name)).toContain('order')
  })

  // -------------------------------------------------------------------
  // GENERATE-02 — returns empty when no modules dir
  // -------------------------------------------------------------------
  it('GENERATE-02 — returns empty when no modules dir', () => {
    const result = scanDmlModels(TMP)
    expect(result.entities).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // GENERATE-03 — entity file path is relative
  // -------------------------------------------------------------------
  it('GENERATE-03 — entity file paths are relative to cwd', () => {
    mkdirSync(join(TMP, 'src/modules/product/models'), { recursive: true })
    writeFileSync(join(TMP, 'src/modules/product/models/product.ts'), 'export default {}')

    const result = scanDmlModels(TMP)
    expect(result.entities[0]!.file).toBe('src/modules/product/models/product.ts')
  })

  // -------------------------------------------------------------------
  // GENERATE-04 — detectRenames finds candidates
  // -------------------------------------------------------------------
  it('GENERATE-04 — detects rename candidates by same table + type', () => {
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

  // -------------------------------------------------------------------
  // GENERATE-05 — no match on different types
  // -------------------------------------------------------------------
  it('GENERATE-05 — no rename match on different types', () => {
    const dropped = [{ table: 'products', column: 'price', type: 'integer' }]
    const added = [{ table: 'products', column: 'amount', type: 'text' }]
    expect(detectRenames(dropped, added)).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // GENERATE-06 — no match on different tables
  // -------------------------------------------------------------------
  it('GENERATE-06 — no rename match on different tables', () => {
    const dropped = [{ table: 'products', column: 'title', type: 'text' }]
    const added = [{ table: 'orders', column: 'name', type: 'text' }]
    expect(detectRenames(dropped, added)).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // GENERATE-07 — sorted alphabetically by dropped column
  // -------------------------------------------------------------------
  it('GENERATE-07 — rename candidates sorted by dropped column', () => {
    const dropped = [
      { table: 'products', column: 'description', type: 'text' },
      { table: 'products', column: 'title', type: 'text' },
    ]
    const added = [
      { table: 'products', column: 'summary', type: 'text' },
      { table: 'products', column: 'name', type: 'text' },
    ]
    const renames = detectRenames(dropped, added)
    expect(renames[0]!.from).toBe('description')
  })

  // -------------------------------------------------------------------
  // GENERATE-08 — isNonInteractive checks CI
  // -------------------------------------------------------------------
  it('GENERATE-08 — isNonInteractive true when CI=true', () => {
    const orig = process.env['CI']
    process.env['CI'] = 'true'
    expect(isNonInteractive()).toBe(true)
    if (orig !== undefined) process.env['CI'] = orig
    else delete process.env['CI']
  })

  // -------------------------------------------------------------------
  // GENERATE-09 — isNonInteractive checks MANTA_NON_INTERACTIVE
  // -------------------------------------------------------------------
  it('GENERATE-09 — isNonInteractive true when MANTA_NON_INTERACTIVE=true', () => {
    const orig = process.env['MANTA_NON_INTERACTIVE']
    process.env['MANTA_NON_INTERACTIVE'] = 'true'
    expect(isNonInteractive()).toBe(true)
    if (orig !== undefined) process.env['MANTA_NON_INTERACTIVE'] = orig
    else delete process.env['MANTA_NON_INTERACTIVE']
  })

  // -------------------------------------------------------------------
  // GENERATE-10 — detectDangerousChanges finds DROP COLUMN
  // -------------------------------------------------------------------
  it('GENERATE-10 — detects DROP COLUMN', () => {
    const sql = 'ALTER TABLE products\n  DROP COLUMN legacy_sku;'
    const warnings = detectDangerousChanges(sql)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some((w) => w.includes('DROP COLUMN'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // GENERATE-11 — detectDangerousChanges finds DROP TABLE
  // -------------------------------------------------------------------
  it('GENERATE-11 — detects DROP TABLE', () => {
    const sql = 'DROP TABLE old_products;'
    const warnings = detectDangerousChanges(sql)
    expect(warnings.length).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------
  // GENERATE-14 — scans only .ts and .js files
  // -------------------------------------------------------------------
  it('GENERATE-14 — ignores non-ts/js files in models/', () => {
    mkdirSync(join(TMP, 'src/modules/product/models'), { recursive: true })
    writeFileSync(join(TMP, 'src/modules/product/models/product.ts'), '')
    writeFileSync(join(TMP, 'src/modules/product/models/README.md'), '')
    writeFileSync(join(TMP, 'src/modules/product/models/.gitkeep'), '')

    const result = scanDmlModels(TMP)
    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]!.name).toBe('product')
  })
})

// ── Command tests with mocked deps ─────────────────────────────────

describe('B6 — db:generate — command', () => {
  beforeEach(setup)
  afterEach(teardown)

  // -------------------------------------------------------------------
  // GENERATE-12 — generateCommand returns result structure
  // -------------------------------------------------------------------
  it('GENERATE-12 — generateCommand returns proper result', async () => {
    const deps = createMockDeps()
    const result = await generateCommand({}, TMP, deps)
    expect(typeof result.exitCode).toBe('number')
    expect(Array.isArray(result.errors)).toBe(true)
    expect(Array.isArray(result.warnings)).toBe(true)
  })

  // -------------------------------------------------------------------
  // GENERATE-13 — "No schema changes" if no entities found
  // -------------------------------------------------------------------
  it('GENERATE-13 — noChanges=true when no DML entities', async () => {
    const deps = createMockDeps()
    const result = await generateCommand({}, TMP, deps)
    expect(result.noChanges).toBe(true)
    expect(result.warnings.some((w) => w.includes('No DML entities'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // GENERATE-15 — calls drizzle-kit generate when entities found
  // -------------------------------------------------------------------
  it('GENERATE-15 — calls drizzle-kit generate when entities exist', async () => {
    mkdirSync(join(TMP, 'src/modules/product/models'), { recursive: true })
    writeFileSync(join(TMP, 'src/modules/product/models/product.ts'), 'export default {}')

    const deps = createMockDeps({
      drizzleKit: {
        generate: vi.fn().mockResolvedValue({
          migrationFile: '0001_add_products.sql',
          sql: 'CREATE TABLE products (id serial);',
        }),
      },
    })

    const result = await generateCommand({}, TMP, deps)
    expect(result.exitCode).toBe(0)
    expect(deps.drizzleKit.generate).toHaveBeenCalled()
    expect(result.migrationFile).toBe('0001_add_products.sql')
  })

  // -------------------------------------------------------------------
  // GENERATE-16 — writes rollback skeleton when migration generated
  // -------------------------------------------------------------------
  it('GENERATE-16 — writes rollback skeleton for new migration', async () => {
    mkdirSync(join(TMP, 'src/modules/product/models'), { recursive: true })
    writeFileSync(join(TMP, 'src/modules/product/models/product.ts'), 'export default {}')

    const deps = createMockDeps({
      drizzleKit: {
        generate: vi.fn().mockResolvedValue({
          migrationFile: '0001_add_products.sql',
          sql: 'CREATE TABLE products (id serial);',
        }),
      },
    })

    await generateCommand({}, TMP, deps)
    expect(deps.migrationFs.writeRollbackSkeleton).toHaveBeenCalledWith('0001_add_products.sql')
  })

  // -------------------------------------------------------------------
  // GENERATE-17 — noChanges when drizzle-kit returns no migration
  // -------------------------------------------------------------------
  it('GENERATE-17 — noChanges when drizzle-kit finds no diff', async () => {
    mkdirSync(join(TMP, 'src/modules/product/models'), { recursive: true })
    writeFileSync(join(TMP, 'src/modules/product/models/product.ts'), 'export default {}')

    const deps = createMockDeps({
      drizzleKit: {
        generate: vi.fn().mockResolvedValue({
          migrationFile: null,
          sql: null,
        }),
      },
    })

    const result = await generateCommand({}, TMP, deps)
    expect(result.noChanges).toBe(true)
  })

  // -------------------------------------------------------------------
  // GENERATE-18 — dangerous changes detected in generated SQL
  // -------------------------------------------------------------------
  it('GENERATE-18 — warns about dangerous changes in generated SQL', async () => {
    mkdirSync(join(TMP, 'src/modules/product/models'), { recursive: true })
    writeFileSync(join(TMP, 'src/modules/product/models/product.ts'), 'export default {}')

    const deps = createMockDeps({
      drizzleKit: {
        generate: vi.fn().mockResolvedValue({
          migrationFile: '0002_drop_legacy.sql',
          sql: 'DROP TABLE old_products;\nDROP COLUMN legacy_sku;',
        }),
      },
    })

    const result = await generateCommand({}, TMP, deps)
    expect(result.warnings.some((w) => w.includes('DROP TABLE'))).toBe(true)
  })
})
