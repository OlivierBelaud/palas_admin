// Section B7 — db:migrate command
// Ref: CLI_SPEC §2.3, CLI_TESTS_SPEC §B7
// Tests: lock acquisition, pending detection, dry-run, all-or-nothing,
//        concurrent index, tracking, lock release

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectConcurrentIndex, findPendingMigrations, migrateCommand } from '../../../../src/commands/db/migrate'
import type { MigrateDeps } from '../../../../src/commands/db/types'

// ── Mock factories ──────────────────────────────────────────────────

function createMockDeps(overrides: Partial<MigrateDeps> = {}): MigrateDeps {
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
    lock: {
      acquire: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(undefined),
      forceRelease: vi.fn().mockResolvedValue(undefined),
    },
    tracker: {
      ensureTable: vi.fn().mockResolvedValue(undefined),
      getApplied: vi.fn().mockResolvedValue([]),
      record: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    fs: {
      listMigrationFiles: vi.fn().mockResolvedValue([]),
      readMigrationSql: vi.fn().mockResolvedValue('CREATE TABLE test (id serial);'),
      readRollbackSql: vi.fn().mockResolvedValue(null),
      rollbackFileExists: vi.fn().mockReturnValue(false),
      readRollbackContent: vi.fn().mockReturnValue(null),
    },
    ...overrides,
  }
}

// ── Pure function tests ─────────────────────────────────────────────

describe('B7 — db:migrate — pure functions', () => {
  it('detectConcurrentIndex detects CREATE INDEX CONCURRENTLY', () => {
    expect(detectConcurrentIndex('CREATE INDEX CONCURRENTLY idx ON t(x);')).toBe(true)
  })

  it('detectConcurrentIndex returns false for normal CREATE INDEX', () => {
    expect(detectConcurrentIndex('CREATE INDEX idx ON t(x);')).toBe(false)
  })

  it('detectConcurrentIndex is case-insensitive', () => {
    expect(detectConcurrentIndex('create index concurrently idx on t(x);')).toBe(true)
  })

  it('findPendingMigrations returns unapplied migrations', () => {
    const pending = findPendingMigrations(['0001.sql', '0002.sql', '0003.sql'], ['0001.sql'])
    expect(pending).toEqual(['0002.sql', '0003.sql'])
  })

  it('findPendingMigrations returns empty when all applied', () => {
    expect(findPendingMigrations(['0001.sql'], ['0001.sql'])).toHaveLength(0)
  })
})

// ── Command integration tests with mocked deps ─────────────────────

describe('B7 — db:migrate — command', () => {
  // -------------------------------------------------------------------
  // MIGRATE-01 — acquires lock before applying
  // -------------------------------------------------------------------
  it('MIGRATE-01 — acquires migration lock', async () => {
    const deps = createMockDeps()
    await migrateCommand({}, deps)
    expect(deps.lock.acquire).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------
  // MIGRATE-02 — releases lock after success
  // -------------------------------------------------------------------
  it('MIGRATE-02 — releases lock after completion', async () => {
    const deps = createMockDeps()
    await migrateCommand({}, deps)
    expect(deps.lock.release).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------
  // MIGRATE-03 — releases lock even after failure
  // -------------------------------------------------------------------
  it('MIGRATE-03 — releases lock even on failure', async () => {
    const deps = createMockDeps({
      db: {
        execute: vi.fn().mockRejectedValue(new Error('SQL error')),
        query: vi.fn().mockResolvedValue([]),
        transaction: vi.fn(),
        close: vi.fn(),
      },
    })
    ;(deps.fs.listMigrationFiles as ReturnType<typeof vi.fn>).mockResolvedValue(['0001.sql'])
    ;(deps.tracker.getApplied as ReturnType<typeof vi.fn>).mockResolvedValue([])

    await migrateCommand({}, deps)
    expect(deps.lock.release).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------
  // MIGRATE-04 — exit(1) if lock timeout
  // -------------------------------------------------------------------
  it('MIGRATE-04 — exit 1 if lock acquisition fails (timeout)', async () => {
    const deps = createMockDeps()
    ;(deps.lock.acquire as ReturnType<typeof vi.fn>).mockResolvedValue(false)

    const result = await migrateCommand({}, deps)
    expect(result.exitCode).toBe(1)
    expect(result.errors[0]).toContain('lock')
  })

  // -------------------------------------------------------------------
  // MIGRATE-05 — --force-unlock releases and exits 0
  // -------------------------------------------------------------------
  it('MIGRATE-05 — --force-unlock releases lock and exits 0', async () => {
    const deps = createMockDeps()
    const result = await migrateCommand({ forceUnlock: true }, deps)
    expect(result.exitCode).toBe(0)
    expect(deps.lock.forceRelease).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------
  // MIGRATE-06 — "up to date" when no pending migrations
  // -------------------------------------------------------------------
  it('MIGRATE-06 — reports 0 pending when all applied', async () => {
    const deps = createMockDeps()
    ;(deps.fs.listMigrationFiles as ReturnType<typeof vi.fn>).mockResolvedValue(['0001.sql'])
    ;(deps.tracker.getApplied as ReturnType<typeof vi.fn>).mockResolvedValue(['0001.sql'])

    const result = await migrateCommand({}, deps)
    expect(result.exitCode).toBe(0)
    expect(result.pendingCount).toBe(0)
    expect(result.appliedCount).toBe(0)
  })

  // -------------------------------------------------------------------
  // MIGRATE-07 — applies pending migrations in order
  // -------------------------------------------------------------------
  it('MIGRATE-07 — applies pending migrations and records them', async () => {
    const deps = createMockDeps()
    ;(deps.fs.listMigrationFiles as ReturnType<typeof vi.fn>).mockResolvedValue(['0001.sql', '0002.sql'])
    ;(deps.tracker.getApplied as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(deps.fs.readMigrationSql as ReturnType<typeof vi.fn>).mockResolvedValue('CREATE TABLE test (id serial);')

    const result = await migrateCommand({}, deps)
    expect(result.exitCode).toBe(0)
    expect(result.appliedCount).toBe(2)
    expect(deps.tracker.record).toHaveBeenCalledTimes(2)
  })

  // -------------------------------------------------------------------
  // MIGRATE-08 — --dry-run shows SQL without applying
  // -------------------------------------------------------------------
  it('MIGRATE-08 — --dry-run returns SQL without executing', async () => {
    const deps = createMockDeps()
    ;(deps.fs.listMigrationFiles as ReturnType<typeof vi.fn>).mockResolvedValue(['0001.sql'])
    ;(deps.tracker.getApplied as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(deps.fs.readMigrationSql as ReturnType<typeof vi.fn>).mockResolvedValue('CREATE TABLE products (id serial);')

    const result = await migrateCommand({ dryRun: true }, deps)
    expect(result.exitCode).toBe(0)
    expect(result.dryRunSql).toBeDefined()
    expect(result.dryRunSql!.length).toBeGreaterThan(0)
    expect(deps.db.execute).not.toHaveBeenCalled()
    expect(deps.tracker.record).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------
  // MIGRATE-09 — --all-or-nothing + CONCURRENT = exit 1 before execution
  // -------------------------------------------------------------------
  it('MIGRATE-09 — --all-or-nothing rejects CREATE INDEX CONCURRENTLY', async () => {
    const deps = createMockDeps()
    ;(deps.fs.listMigrationFiles as ReturnType<typeof vi.fn>).mockResolvedValue(['0001.sql'])
    ;(deps.tracker.getApplied as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(deps.fs.readMigrationSql as ReturnType<typeof vi.fn>).mockResolvedValue('CREATE INDEX CONCURRENTLY idx ON t(x);')

    const result = await migrateCommand({ allOrNothing: true }, deps)
    expect(result.exitCode).toBe(1)
    expect(result.errors[0]).toContain('CONCURRENTLY')
    expect(deps.db.execute).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------
  // MIGRATE-10 — partial failure records only successful migrations
  // -------------------------------------------------------------------
  it('MIGRATE-10 — on failure, records only successful migrations', async () => {
    const executeFn = vi
      .fn()
      .mockResolvedValueOnce(undefined) // 0001 succeeds
      .mockRejectedValueOnce(new Error('syntax error')) // 0002 fails

    const deps = createMockDeps({
      db: {
        execute: executeFn,
        query: vi.fn().mockResolvedValue([]),
        transaction: vi.fn(),
        close: vi.fn(),
      },
    })
    ;(deps.fs.listMigrationFiles as ReturnType<typeof vi.fn>).mockResolvedValue(['0001.sql', '0002.sql'])
    ;(deps.tracker.getApplied as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(deps.fs.readMigrationSql as ReturnType<typeof vi.fn>).mockResolvedValue('CREATE TABLE test (id serial);')

    const result = await migrateCommand({}, deps)
    expect(result.exitCode).toBe(1)
    expect(result.appliedCount).toBe(1)
    // First migration was recorded, second was not
    expect(deps.tracker.record).toHaveBeenCalledTimes(1)
  })

  // -------------------------------------------------------------------
  // MIGRATE-11 — --all-or-nothing rolls back all on failure
  // -------------------------------------------------------------------
  it('MIGRATE-11 — --all-or-nothing rolls back all on failure', async () => {
    const txExecute = vi
      .fn()
      .mockResolvedValueOnce(undefined) // 0001 succeeds in tx
      .mockRejectedValueOnce(new Error('syntax error')) // 0002 fails in tx

    const txClient = {
      execute: txExecute,
      query: vi.fn().mockResolvedValue([]),
      transaction: vi.fn(),
      close: vi.fn(),
    }

    const deps = createMockDeps({
      db: {
        execute: vi.fn(),
        query: vi.fn().mockResolvedValue([]),
        transaction: vi.fn().mockImplementation(async (fn) => fn(txClient)),
        close: vi.fn(),
      },
    })
    ;(deps.fs.listMigrationFiles as ReturnType<typeof vi.fn>).mockResolvedValue(['0001.sql', '0002.sql'])
    ;(deps.tracker.getApplied as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(deps.fs.readMigrationSql as ReturnType<typeof vi.fn>).mockResolvedValue('CREATE TABLE test (id serial);')

    const result = await migrateCommand({ allOrNothing: true }, deps)
    expect(result.exitCode).toBe(1)
    // None should be recorded since transaction was rolled back
    expect(result.appliedCount).toBe(0)
    expect(result.errors[0]).toContain('rolled back')
  })

  // -------------------------------------------------------------------
  // MIGRATE-12 — ensures tracking table exists
  // -------------------------------------------------------------------
  it('MIGRATE-12 — ensures tracking table exists', async () => {
    const deps = createMockDeps()
    await migrateCommand({}, deps)
    expect(deps.tracker.ensureTable).toHaveBeenCalled()
  })
})
