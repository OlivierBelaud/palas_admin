// Section B8 — db:rollback command
// Ref: CLI_SPEC §2.4, CLI_TESTS_SPEC §B8
// Tests: rollback with mocked deps, file validation, stop-on-first-failure

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rollbackCommand, validateRollbackFile } from '../../../../src/commands/db/rollback'
import type { RollbackDeps } from '../../../../src/commands/db/types'

const TMP = resolve(__dirname, '__tmp_rollback_test__')

function setup() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
}
function teardown() {
  rmSync(TMP, { recursive: true, force: true })
}

// ── Mock factories ──────────────────────────────────────────────────

function createMockDeps(overrides: Partial<RollbackDeps> = {}): RollbackDeps {
  return {
    db: {
      execute: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      transaction: vi.fn().mockImplementation(async (fn) =>
        fn({
          execute: vi.fn().mockResolvedValue(undefined),
          query: vi.fn().mockResolvedValue([]),
          transaction: vi.fn(),
          close: vi.fn(),
        }),
      ),
      close: vi.fn().mockResolvedValue(undefined),
    },
    tracker: {
      ensureTable: vi.fn().mockResolvedValue(undefined),
      getApplied: vi.fn().mockResolvedValue([]),
      record: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    fs: {
      listMigrationFiles: vi.fn().mockResolvedValue([]),
      readMigrationSql: vi.fn().mockResolvedValue(''),
      readRollbackSql: vi.fn().mockResolvedValue('DROP TABLE test;'),
      rollbackFileExists: vi.fn().mockReturnValue(true),
      readRollbackContent: vi.fn().mockReturnValue('DROP TABLE test;'),
    },
    ...overrides,
  }
}

// ── Pure function tests ─────────────────────────────────────────────

describe('B8 — db:rollback — file validation', () => {
  beforeEach(setup)
  afterEach(teardown)

  // -------------------------------------------------------------------
  // ROLLBACK-01 — error if .down.sql absent
  // -------------------------------------------------------------------
  it('ROLLBACK-01 — returns error if rollback file missing', () => {
    const error = validateRollbackFile('drizzle/migrations/0001.down.sql', TMP)
    expect(error).not.toBeNull()
    expect(error).toContain('not found')
  })

  // -------------------------------------------------------------------
  // ROLLBACK-02 — error if .down.sql is TODO placeholder
  // -------------------------------------------------------------------
  it('ROLLBACK-02 — returns error if file is TODO placeholder', () => {
    mkdirSync(join(TMP, 'drizzle/migrations'), { recursive: true })
    writeFileSync(join(TMP, 'drizzle/migrations/0001.down.sql'), '-- TODO: Write rollback SQL for this migration')
    const error = validateRollbackFile('drizzle/migrations/0001.down.sql', TMP)
    expect(error).not.toBeNull()
    expect(error).toContain('TODO placeholder')
  })

  // -------------------------------------------------------------------
  // ROLLBACK-03 — null if file has real SQL
  // -------------------------------------------------------------------
  it('ROLLBACK-03 — returns null if file has real SQL', () => {
    mkdirSync(join(TMP, 'drizzle/migrations'), { recursive: true })
    writeFileSync(join(TMP, 'drizzle/migrations/0001.down.sql'), 'DROP TABLE products;')
    const error = validateRollbackFile('drizzle/migrations/0001.down.sql', TMP)
    expect(error).toBeNull()
  })

  // -------------------------------------------------------------------
  // ROLLBACK-04 — error if file is empty
  // -------------------------------------------------------------------
  it('ROLLBACK-04 — returns error if file is empty', () => {
    mkdirSync(join(TMP, 'drizzle/migrations'), { recursive: true })
    writeFileSync(join(TMP, 'drizzle/migrations/0001.down.sql'), '')
    const error = validateRollbackFile('drizzle/migrations/0001.down.sql', TMP)
    expect(error).not.toBeNull()
  })
})

// ── Command tests with mocked deps ─────────────────────────────────

describe('B8 — db:rollback — command', () => {
  // -------------------------------------------------------------------
  // ROLLBACK-05 — rollbacks last migration by default (steps=1)
  // -------------------------------------------------------------------
  it('ROLLBACK-05 — rollbacks last migration by default', async () => {
    const deps = createMockDeps()
    ;(deps.tracker.getApplied as ReturnType<typeof vi.fn>).mockResolvedValue(['0001.sql', '0002.sql'])
    ;(deps.fs.rollbackFileExists as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(deps.fs.readRollbackContent as ReturnType<typeof vi.fn>).mockReturnValue('DROP TABLE t;')
    ;(deps.fs.readRollbackSql as ReturnType<typeof vi.fn>).mockResolvedValue('DROP TABLE t;')

    const result = await rollbackCommand({}, deps)
    expect(result.exitCode).toBe(0)
    expect(result.rolledBack).toHaveLength(1)
    expect(result.rolledBack[0]).toBe('0002.sql')
  })

  // -------------------------------------------------------------------
  // ROLLBACK-06 — --steps N rolls back N migrations
  // -------------------------------------------------------------------
  it('ROLLBACK-06 — --steps 2 rolls back 2 migrations', async () => {
    const deps = createMockDeps()
    ;(deps.tracker.getApplied as ReturnType<typeof vi.fn>).mockResolvedValue(['0001.sql', '0002.sql', '0003.sql'])
    ;(deps.fs.rollbackFileExists as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(deps.fs.readRollbackContent as ReturnType<typeof vi.fn>).mockReturnValue('DROP TABLE t;')
    ;(deps.fs.readRollbackSql as ReturnType<typeof vi.fn>).mockResolvedValue('DROP TABLE t;')

    const result = await rollbackCommand({ steps: 2 }, deps)
    expect(result.exitCode).toBe(0)
    expect(result.rolledBack).toHaveLength(2)
    // Reverse order: 0003 first, then 0002
    expect(result.rolledBack[0]).toBe('0003.sql')
    expect(result.rolledBack[1]).toBe('0002.sql')
  })

  // -------------------------------------------------------------------
  // ROLLBACK-07 — exit 1 if .down.sql absent
  // -------------------------------------------------------------------
  it('ROLLBACK-07 — exit 1 if rollback file not found', async () => {
    const deps = createMockDeps()
    ;(deps.tracker.getApplied as ReturnType<typeof vi.fn>).mockResolvedValue(['0001.sql'])
    ;(deps.fs.rollbackFileExists as ReturnType<typeof vi.fn>).mockReturnValue(false)

    const result = await rollbackCommand({}, deps)
    expect(result.exitCode).toBe(1)
    expect(result.errors[0]).toContain('not found')
    expect(result.rolledBack).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // ROLLBACK-08 — exit 1 if .down.sql is TODO placeholder
  // -------------------------------------------------------------------
  it('ROLLBACK-08 — exit 1 if rollback file is TODO placeholder', async () => {
    const deps = createMockDeps()
    ;(deps.tracker.getApplied as ReturnType<typeof vi.fn>).mockResolvedValue(['0001.sql'])
    ;(deps.fs.rollbackFileExists as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(deps.fs.readRollbackContent as ReturnType<typeof vi.fn>).mockReturnValue(
      '-- TODO: Write rollback SQL for this migration',
    )

    const result = await rollbackCommand({}, deps)
    expect(result.exitCode).toBe(1)
    expect(result.errors[0]).toContain('TODO')
    expect(result.rolledBack).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // ROLLBACK-09 — exit 1 if SQL execution fails, stop immediately
  // -------------------------------------------------------------------
  it('ROLLBACK-09 — exit 1 if SQL execution fails', async () => {
    const txExecute = vi.fn().mockRejectedValue(new Error('column does not exist'))
    const deps = createMockDeps({
      db: {
        execute: vi.fn(),
        query: vi.fn().mockResolvedValue([]),
        transaction: vi.fn().mockImplementation(async (fn) =>
          fn({
            execute: txExecute,
            query: vi.fn().mockResolvedValue([]),
            transaction: vi.fn(),
            close: vi.fn(),
          }),
        ),
        close: vi.fn(),
      },
    })
    ;(deps.tracker.getApplied as ReturnType<typeof vi.fn>).mockResolvedValue(['0001.sql', '0002.sql'])
    ;(deps.fs.rollbackFileExists as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(deps.fs.readRollbackContent as ReturnType<typeof vi.fn>).mockReturnValue('DROP TABLE t;')
    ;(deps.fs.readRollbackSql as ReturnType<typeof vi.fn>).mockResolvedValue('DROP TABLE t;')

    const result = await rollbackCommand({ steps: 2 }, deps)
    expect(result.exitCode).toBe(1)
    expect(result.errors[0]).toContain('inconsistent state')
    // First rollback (0002) failed, 0001 was never attempted
    expect(result.rolledBack).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // ROLLBACK-10 — tracking updated only for successful rollbacks
  // -------------------------------------------------------------------
  it('ROLLBACK-10 — tracker.remove called only for successful rollbacks', async () => {
    const deps = createMockDeps()
    ;(deps.tracker.getApplied as ReturnType<typeof vi.fn>).mockResolvedValue(['0001.sql', '0002.sql'])
    ;(deps.fs.rollbackFileExists as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(deps.fs.readRollbackContent as ReturnType<typeof vi.fn>).mockReturnValue('DROP TABLE t;')
    ;(deps.fs.readRollbackSql as ReturnType<typeof vi.fn>).mockResolvedValue('DROP TABLE t;')

    await rollbackCommand({ steps: 2 }, deps)
    expect(deps.tracker.remove).toHaveBeenCalledTimes(2)
    expect(deps.tracker.remove).toHaveBeenCalledWith('0002.sql')
    expect(deps.tracker.remove).toHaveBeenCalledWith('0001.sql')
  })

  // -------------------------------------------------------------------
  // ROLLBACK-11 — 0 applied = nothing to rollback
  // -------------------------------------------------------------------
  it('ROLLBACK-11 — nothing to rollback when no applied migrations', async () => {
    const deps = createMockDeps()
    ;(deps.tracker.getApplied as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const result = await rollbackCommand({}, deps)
    expect(result.exitCode).toBe(0)
    expect(result.rolledBack).toHaveLength(0)
  })
})
