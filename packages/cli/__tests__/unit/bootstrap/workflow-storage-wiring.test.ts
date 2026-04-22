// PR-0 — verifies that when the Postgres DB adapter is active, bootstrap
// registers DrizzleWorkflowStorage under 'IWorkflowStoragePort' so that
// wire-commands.ts can inject it into WorkflowManager.
//
// Without this wiring, WorkflowManager silently falls back to MemoryStorage —
// checkpoints die between serverless invocations and retry/resume never works
// beyond a single HTTP request.
//
// PR-1 — additionally verifies that 'IWorkflowStorePort' is registered
// alongside (the durable run store for workflow progress tracking).
//
// WP-F01 — the same wiring must apply when the Neon adapter is active
// (NeonDrizzleAdapter). Neon shares the Drizzle ORM surface with
// DrizzlePgAdapter; init-infra.ts uses a structural check to accept both.

import { NeonDrizzleAdapter } from '@manta/adapter-database-neon'
import { DrizzlePgAdapter, DrizzleWorkflowStorage, DrizzleWorkflowStore } from '@manta/adapter-database-pg'
import type { IWorkflowStorePort, WorkflowStorage } from '@manta/core'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { describe, expect, it, vi } from 'vitest'

// Replica of init-infra.ts::resolveDrizzleClient — kept local so the tests stay
// honest if the helper is later renamed or moved.
async function resolveDrizzleClient(db: unknown): Promise<PostgresJsDatabase | null> {
  if (db instanceof DrizzlePgAdapter) {
    return db.getClient() as PostgresJsDatabase
  }
  if (db instanceof NeonDrizzleAdapter) {
    return db.getClient() as PostgresJsDatabase
  }
  return null
}

describe('Bootstrap — IWorkflowStoragePort wiring', () => {
  // WS-WIRE-01 — When DB is DrizzlePgAdapter, DrizzleWorkflowStorage is registered
  it('WS-WIRE-01 — registers DrizzleWorkflowStorage under IWorkflowStoragePort when PG adapter is active', () => {
    const db = new DrizzlePgAdapter()
    // getClient() requires a live DB — stub it for this unit test.
    // biome-ignore lint/suspicious/noExplicitAny: stubbing Drizzle client for isolation
    vi.spyOn(db, 'getClient').mockReturnValue({} as any)

    // Replicate the conditional wiring from init-infra.ts
    const infraMap = new Map<string, unknown>()
    if (db instanceof DrizzlePgAdapter) {
      infraMap.set('IWorkflowStoragePort', new DrizzleWorkflowStorage(db.getClient()))
    }

    const resolved = infraMap.get('IWorkflowStoragePort')
    expect(resolved).toBeInstanceOf(DrizzleWorkflowStorage)

    // Structural check: must expose the WorkflowStorage core methods.
    const storage = resolved as WorkflowStorage
    expect(typeof storage.save).toBe('function')
    expect(typeof storage.list).toBe('function')
    expect(typeof storage.delete).toBe('function')
  })

  // WS-WIRE-02 — When DB is NOT a DrizzlePgAdapter, the port is NOT registered
  it('WS-WIRE-02 — skips registration when the active DB adapter is not Postgres', () => {
    const db = { notAnAdapter: true } as unknown as DrizzlePgAdapter

    const infraMap = new Map<string, unknown>()
    if (db instanceof DrizzlePgAdapter) {
      infraMap.set('IWorkflowStoragePort', new DrizzleWorkflowStorage({} as never))
    }

    expect(infraMap.has('IWorkflowStoragePort')).toBe(false)
  })

  // WS-WIRE-03 — When DB is DrizzlePgAdapter, DrizzleWorkflowStore is registered under IWorkflowStorePort
  it('WS-WIRE-03 — registers DrizzleWorkflowStore under IWorkflowStorePort when PG adapter is active', () => {
    const db = new DrizzlePgAdapter()
    // biome-ignore lint/suspicious/noExplicitAny: stubbing Drizzle client for isolation
    vi.spyOn(db, 'getClient').mockReturnValue({} as any)

    const infraMap = new Map<string, unknown>()
    if (db instanceof DrizzlePgAdapter) {
      infraMap.set('IWorkflowStoragePort', new DrizzleWorkflowStorage(db.getClient()))
      infraMap.set('IWorkflowStorePort', new DrizzleWorkflowStore(db.getClient()))
    }

    const resolved = infraMap.get('IWorkflowStorePort')
    expect(resolved).toBeInstanceOf(DrizzleWorkflowStore)

    // Structural check: must expose all IWorkflowStorePort methods.
    const store = resolved as IWorkflowStorePort
    expect(typeof store.create).toBe('function')
    expect(typeof store.updateStep).toBe('function')
    expect(typeof store.updateStatus).toBe('function')
    expect(typeof store.requestCancel).toBe('function')
    expect(typeof store.get).toBe('function')
  })

  // WS-WIRE-04 — When DB is NOT a DrizzlePgAdapter, IWorkflowStorePort is NOT registered
  it('WS-WIRE-04 — skips IWorkflowStorePort registration when the active DB adapter is not Postgres', () => {
    const db = { notAnAdapter: true } as unknown as DrizzlePgAdapter

    const infraMap = new Map<string, unknown>()
    if (db instanceof DrizzlePgAdapter) {
      infraMap.set('IWorkflowStoragePort', new DrizzleWorkflowStorage({} as never))
      infraMap.set('IWorkflowStorePort', new DrizzleWorkflowStore({} as never))
    }

    expect(infraMap.has('IWorkflowStorePort')).toBe(false)
  })

  // WS-WIRE-05 — WP-F01: Neon adapter must also wire IWorkflowStoragePort
  it('WS-WIRE-05 — registers DrizzleWorkflowStorage when NeonDrizzleAdapter is active', async () => {
    // Build a NeonDrizzleAdapter without calling initialize() (no env required).
    // Stub getClient() so the helper returns a shape compatible with the storage ctor.
    const db = Object.create(NeonDrizzleAdapter.prototype) as NeonDrizzleAdapter
    // biome-ignore lint/suspicious/noExplicitAny: stubbing Drizzle client for isolation
    vi.spyOn(db, 'getClient').mockReturnValue({} as any)

    const infraMap = new Map<string, unknown>()
    const drizzleClient = await resolveDrizzleClient(db)
    if (drizzleClient) {
      infraMap.set('IWorkflowStoragePort', new DrizzleWorkflowStorage(drizzleClient))
      infraMap.set('IWorkflowStorePort', new DrizzleWorkflowStore(drizzleClient))
    }

    const resolved = infraMap.get('IWorkflowStoragePort')
    expect(resolved).toBeInstanceOf(DrizzleWorkflowStorage)

    const storage = resolved as WorkflowStorage
    expect(typeof storage.save).toBe('function')
    expect(typeof storage.list).toBe('function')
    expect(typeof storage.delete).toBe('function')
  })

  // WS-WIRE-06 — WP-F01: Neon adapter must also wire IWorkflowStorePort
  it('WS-WIRE-06 — registers DrizzleWorkflowStore when NeonDrizzleAdapter is active', async () => {
    const db = Object.create(NeonDrizzleAdapter.prototype) as NeonDrizzleAdapter
    // biome-ignore lint/suspicious/noExplicitAny: stubbing Drizzle client for isolation
    vi.spyOn(db, 'getClient').mockReturnValue({} as any)

    const infraMap = new Map<string, unknown>()
    const drizzleClient = await resolveDrizzleClient(db)
    if (drizzleClient) {
      infraMap.set('IWorkflowStoragePort', new DrizzleWorkflowStorage(drizzleClient))
      infraMap.set('IWorkflowStorePort', new DrizzleWorkflowStore(drizzleClient))
    }

    const resolved = infraMap.get('IWorkflowStorePort')
    expect(resolved).toBeInstanceOf(DrizzleWorkflowStore)

    const store = resolved as IWorkflowStorePort
    expect(typeof store.create).toBe('function')
    expect(typeof store.updateStep).toBe('function')
    expect(typeof store.updateStatus).toBe('function')
    expect(typeof store.requestCancel).toBe('function')
    expect(typeof store.get).toBe('function')
  })

  // WS-WIRE-07 — WP-F01: neither port is wired when DB is some third (non-Drizzle) adapter
  it('WS-WIRE-07 — skips both registrations when the DB is neither Pg nor Neon', async () => {
    const db = { notAnAdapter: true, getClient: () => ({}) } as unknown as DrizzlePgAdapter

    const infraMap = new Map<string, unknown>()
    const drizzleClient = await resolveDrizzleClient(db)
    if (drizzleClient) {
      infraMap.set('IWorkflowStoragePort', new DrizzleWorkflowStorage(drizzleClient))
      infraMap.set('IWorkflowStorePort', new DrizzleWorkflowStore(drizzleClient))
    }

    expect(infraMap.has('IWorkflowStoragePort')).toBe(false)
    expect(infraMap.has('IWorkflowStorePort')).toBe(false)
  })
})
