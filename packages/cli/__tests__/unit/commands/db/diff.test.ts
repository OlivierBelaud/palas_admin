// Section B9 — db:diff command
// Ref: CLI_SPEC §2.5, CLI_TESTS_SPEC §B9
// Tests: schema comparison pure functions + command with mocked deps

import { describe, it, expect, vi } from 'vitest'
import { compareSchemas, diffCommand } from '../../../../src/commands/db/diff'
import type { DiffDeps } from '../../../../src/commands/db/types'

// ── Mock factories ──────────────────────────────────────────────────

function createMockDeps(overrides: Partial<DiffDeps> = {}): DiffDeps {
  return {
    db: {
      execute: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      transaction: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  }
}

// ── Pure function tests ─────────────────────────────────────────────

describe('B9 — db:diff — pure functions', () => {
  // -------------------------------------------------------------------
  // DIFF-01 — finds missing tables
  // -------------------------------------------------------------------
  it('DIFF-01 — finds missing tables', () => {
    const expected = [{ table: 'products', columns: ['id', 'title'] }]
    const actual: Array<{ table: string; columns: string[] }> = []

    const { diffs } = compareSchemas(expected, actual)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]!.type).toBe('missing')
    expect(diffs[0]!.entity).toBe('table')
    expect(diffs[0]!.name).toBe('products')
  })

  // -------------------------------------------------------------------
  // DIFF-02 — finds extra tables as notifications
  // -------------------------------------------------------------------
  it('DIFF-02 — finds extra tables as notifications', () => {
    const expected: Array<{ table: string; columns: string[] }> = []
    const actual = [{ table: 'legacy_data', columns: ['id'] }]

    const { notifications } = compareSchemas(expected, actual)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.type).toBe('extra')
    expect(notifications[0]!.name).toBe('legacy_data')
  })

  // -------------------------------------------------------------------
  // DIFF-03 — finds missing columns
  // -------------------------------------------------------------------
  it('DIFF-03 — finds missing columns in existing table', () => {
    const expected = [{ table: 'products', columns: ['id', 'title', 'price'] }]
    const actual = [{ table: 'products', columns: ['id'] }]

    const { diffs } = compareSchemas(expected, actual)
    const missingCols = diffs.filter(d => d.entity === 'column')
    expect(missingCols).toHaveLength(2)
    expect(missingCols.map(d => d.name)).toContain('products.title')
    expect(missingCols.map(d => d.name)).toContain('products.price')
  })

  // -------------------------------------------------------------------
  // DIFF-04 — finds extra columns as notifications
  // -------------------------------------------------------------------
  it('DIFF-04 — finds extra columns as notifications', () => {
    const expected = [{ table: 'products', columns: ['id'] }]
    const actual = [{ table: 'products', columns: ['id', 'legacy_field'] }]

    const { notifications } = compareSchemas(expected, actual)
    const extraCols = notifications.filter(n => n.entity === 'column')
    expect(extraCols).toHaveLength(1)
    expect(extraCols[0]!.name).toBe('products.legacy_field')
  })

  // -------------------------------------------------------------------
  // DIFF-05 — empty when schemas match
  // -------------------------------------------------------------------
  it('DIFF-05 — no diffs when schemas match', () => {
    const schema = [{ table: 'products', columns: ['id', 'title'] }]
    const { diffs, notifications } = compareSchemas(schema, schema)
    expect(diffs).toHaveLength(0)
    expect(notifications).toHaveLength(0)
  })
})

// ── Command tests with mocked deps ─────────────────────────────────

describe('B9 — db:diff — command', () => {
  // -------------------------------------------------------------------
  // DIFF-06 — diffCommand returns result structure
  // -------------------------------------------------------------------
  it('DIFF-06 — diffCommand returns proper result', async () => {
    const deps = createMockDeps()
    const result = await diffCommand(
      {},
      [{ table: 'products', columns: ['id', 'title'] }],
      deps,
    )
    expect(typeof result.exitCode).toBe('number')
    expect(Array.isArray(result.errors)).toBe(true)
    expect(Array.isArray(result.diffs)).toBe(true)
    expect(Array.isArray(result.notifications)).toBe(true)
  })

  // -------------------------------------------------------------------
  // DIFF-07 — read-only: does not call execute
  // -------------------------------------------------------------------
  it('DIFF-07 — read-only: never calls execute', async () => {
    const deps = createMockDeps()
    // Mock query to return some tables
    ;(deps.db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ table_name: 'products' }]) // tables query
      .mockResolvedValueOnce([{ column_name: 'id' }, { column_name: 'title' }]) // columns query

    await diffCommand(
      {},
      [{ table: 'products', columns: ['id', 'title'] }],
      deps,
    )
    expect(deps.db.execute).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------
  // DIFF-08 — detects missing tables from DB introspection
  // -------------------------------------------------------------------
  it('DIFF-08 — detects missing tables from DB introspection', async () => {
    const deps = createMockDeps()
    // DB returns no tables
    ;(deps.db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // no tables in DB

    const result = await diffCommand(
      {},
      [{ table: 'products', columns: ['id', 'title'] }],
      deps,
    )
    expect(result.diffs.some(d => d.type === 'missing' && d.entity === 'table' && d.name === 'products')).toBe(true)
  })

  // -------------------------------------------------------------------
  // DIFF-09 — detects extra tables from DB introspection
  // -------------------------------------------------------------------
  it('DIFF-09 — detects extra tables from DB introspection', async () => {
    const deps = createMockDeps()
    // DB has a table not in expected schema
    ;(deps.db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        { table_name: 'legacy_data', column_name: 'id' },
      ])

    const result = await diffCommand(
      {},
      [], // empty expected schema
      deps,
    )
    expect(result.notifications.some(n => n.type === 'extra' && n.name === 'legacy_data')).toBe(true)
  })

  // -------------------------------------------------------------------
  // DIFF-10 — --json flag included in result
  // -------------------------------------------------------------------
  it('DIFF-10 — json option passed through', async () => {
    const deps = createMockDeps()
    ;(deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const result = await diffCommand({ json: true }, [], deps)
    expect(result.exitCode).toBe(0)
  })
})
