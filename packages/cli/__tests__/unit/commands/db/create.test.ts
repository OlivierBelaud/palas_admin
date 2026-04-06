// Section B10 — db:create command
// Ref: CLI_SPEC §2.6, CLI_TESTS_SPEC §B10
// Tests: URL parsing + command with mocked deps

import { describe, expect, it, vi } from 'vitest'
import { createCommand, extractDbName } from '../../../../src/commands/db/create'
import type { CreateDeps } from '../../../../src/commands/db/types'

// ── Mock factories ──────────────────────────────────────────────────

function createMockDeps(overrides: Partial<CreateDeps> = {}): CreateDeps {
  return {
    connectMaintenance: vi.fn().mockResolvedValue({
      execute: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      transaction: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    ...overrides,
  }
}

// ── Pure function tests ─────────────────────────────────────────────

describe('B10 — db:create — pure functions', () => {
  // -------------------------------------------------------------------
  // CREATE-01 — extracts DB name from standard URL
  // -------------------------------------------------------------------
  it('CREATE-01 — extracts DB name from PostgreSQL URL', () => {
    expect(extractDbName('postgresql://user:pass@localhost:5432/manta_demo')).toBe('manta_demo')
    expect(extractDbName('postgresql://localhost/mydb')).toBe('mydb')
  })

  // -------------------------------------------------------------------
  // CREATE-02 — strips query params
  // -------------------------------------------------------------------
  it('CREATE-02 — strips query params from URL', () => {
    expect(extractDbName('postgresql://localhost:5432/test?sslmode=require')).toBe('test')
  })

  // -------------------------------------------------------------------
  // CREATE-03 — handles Neon-style URLs
  // -------------------------------------------------------------------
  it('CREATE-03 — handles Neon-style URLs', () => {
    expect(extractDbName('postgresql://user:pass@ep-something.neon.tech/neondb')).toBe('neondb')
  })

  // -------------------------------------------------------------------
  // CREATE-05 — error if URL cannot be parsed
  // -------------------------------------------------------------------
  it('CREATE-05 — empty string URL returns empty dbName', () => {
    expect(extractDbName('')).toBe('')
  })
})

// ── Command tests with mocked deps ─────────────────────────────────

describe('B10 — db:create — command', () => {
  // -------------------------------------------------------------------
  // CREATE-04 — creates DB if it doesn't exist
  // -------------------------------------------------------------------
  it('CREATE-04 — creates DB when it does not exist', async () => {
    const mockClient = {
      execute: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]), // empty = DB doesn't exist
      transaction: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    const deps = createMockDeps({
      connectMaintenance: vi.fn().mockResolvedValue(mockClient),
    })

    const result = await createCommand('postgresql://localhost/testdb', deps)
    expect(result.exitCode).toBe(0)
    expect(result.dbName).toBe('testdb')
    expect(result.created).toBe(true)
    expect(mockClient.execute).toHaveBeenCalled()
    expect(mockClient.close).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------
  // CREATE-06 — "already exists" if DB exists
  // -------------------------------------------------------------------
  it('CREATE-06 — reports already exists when DB found', async () => {
    const mockClient = {
      execute: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([{ datname: 'testdb' }]), // DB exists
      transaction: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    const deps = createMockDeps({
      connectMaintenance: vi.fn().mockResolvedValue(mockClient),
    })

    const result = await createCommand('postgresql://localhost/testdb', deps)
    expect(result.exitCode).toBe(0)
    expect(result.created).toBe(false)
    expect(mockClient.close).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------
  // CREATE-07 — connects via maintenance DB (postgres)
  // -------------------------------------------------------------------
  it('CREATE-07 — connects via maintenance DB', async () => {
    const deps = createMockDeps()

    await createCommand('postgresql://user:pass@localhost:5432/myapp', deps)
    expect(deps.connectMaintenance).toHaveBeenCalled()
    // Should connect with base 'postgres' URL, not the target DB
    const callUrl = (deps.connectMaintenance as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(callUrl).toContain('postgres')
    expect(callUrl).not.toContain('myapp')
  })

  // -------------------------------------------------------------------
  // CREATE-08 — error if connection fails
  // -------------------------------------------------------------------
  it('CREATE-08 — exit 1 if connection fails', async () => {
    const deps = createMockDeps({
      connectMaintenance: vi.fn().mockRejectedValue(new Error('connection refused')),
    })

    const result = await createCommand('postgresql://localhost/testdb', deps)
    expect(result.exitCode).toBe(1)
    expect(result.errors[0]).toContain('connection')
    expect(result.created).toBe(false)
  })

  // -------------------------------------------------------------------
  // CREATE-09 — error if URL has no DB name
  // -------------------------------------------------------------------
  it('CREATE-09 — exit 1 if URL has no DB name', async () => {
    const deps = createMockDeps()
    const result = await createCommand('', deps)
    expect(result.exitCode).toBe(1)
    expect(result.errors[0]).toContain('database name')
  })
})
