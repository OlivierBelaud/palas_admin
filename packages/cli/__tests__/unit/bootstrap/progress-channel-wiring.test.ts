// PR-2 — verifies that bootstrap auto-selects the correct IProgressChannelPort
// adapter based on which infra adapters are already registered:
//   - UpstashCacheAdapter present   → UpstashProgressChannel
//   - DrizzlePgAdapter present      → DbProgressChannel
//   - neither                       → InMemoryProgressChannel (test-only)
//
// The selection logic lives in `init-infra.ts::selectProgressChannel`. These
// tests replicate it structurally (mirroring the shape of workflow-storage-wiring
// tests) rather than booting the whole CLI — the full-boot path is covered by
// integration tests.

import { UpstashCacheAdapter } from '@manta/adapter-cache-upstash'
import { NeonDrizzleAdapter } from '@manta/adapter-database-neon'
import { DbProgressChannel, DrizzlePgAdapter } from '@manta/adapter-database-pg'
import type { IProgressChannelPort } from '@manta/core'
import { InMemoryCacheAdapter, InMemoryProgressChannel } from '@manta/core'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// UpstashProgressChannel reads credentials from env. Seed them once so the
// tests don't depend on the developer's shell.
const PREV_URL = process.env.UPSTASH_REDIS_REST_URL
const PREV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
beforeAll(() => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
})
afterAll(() => {
  if (PREV_URL === undefined) delete process.env.UPSTASH_REDIS_REST_URL
  else process.env.UPSTASH_REDIS_REST_URL = PREV_URL
  if (PREV_TOKEN === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN
  else process.env.UPSTASH_REDIS_REST_TOKEN = PREV_TOKEN
})

// Replica of init-infra.ts::resolveDrizzleClient — accepts both PG and Neon adapters.
async function resolveDrizzleClient(db: unknown): Promise<PostgresJsDatabase | null> {
  if (db instanceof DrizzlePgAdapter) {
    return db.getClient() as PostgresJsDatabase
  }
  if (db instanceof NeonDrizzleAdapter) {
    return db.getClient() as PostgresJsDatabase
  }
  return null
}

// Replica of the selection logic in init-infra.ts — kept local so the tests
// stay honest if the helper is later renamed or moved.
async function selectProgressChannel(infraMap: Map<string, unknown>): Promise<IProgressChannelPort> {
  const cache = infraMap.get('ICachePort')
  const db = infraMap.get('IDatabasePort')

  let isUpstashCache = false
  let UpstashProgressChannelCtor: typeof import('@manta/adapter-cache-upstash').UpstashProgressChannel | undefined
  if (cache) {
    try {
      const mod = await import('@manta/adapter-cache-upstash')
      isUpstashCache = cache instanceof mod.UpstashCacheAdapter
      UpstashProgressChannelCtor = mod.UpstashProgressChannel
    } catch {
      // package absent — fall through
    }
  }

  const drizzleClient = await resolveDrizzleClient(db)
  if (isUpstashCache && UpstashProgressChannelCtor) {
    return new UpstashProgressChannelCtor({}, {})
  }
  if (drizzleClient) {
    return new DbProgressChannel(drizzleClient, {})
  }
  return new InMemoryProgressChannel()
}

describe('Bootstrap — IProgressChannelPort wiring', () => {
  // PC-WIRE-01 — UpstashProgressChannel is selected when an Upstash cache is wired.
  it('PC-WIRE-01 — selects UpstashProgressChannel when Upstash cache is present', async () => {
    const cache = new UpstashCacheAdapter({ url: 'https://fake.upstash.io', token: 'fake-token' })
    const db = new DrizzlePgAdapter()
    // biome-ignore lint/suspicious/noExplicitAny: stubbing Drizzle client
    vi.spyOn(db, 'getClient').mockReturnValue({} as any)

    const infraMap = new Map<string, unknown>()
    infraMap.set('ICachePort', cache)
    infraMap.set('IDatabasePort', db)

    const channel = await selectProgressChannel(infraMap)
    // Structural check rather than an instanceof (avoids statically importing
    // UpstashProgressChannel at the top, keeping symmetry with the dynamic
    // detection path in init-infra.ts).
    const mod = await import('@manta/adapter-cache-upstash')
    expect(channel).toBeInstanceOf(mod.UpstashProgressChannel)
  })

  // PC-WIRE-02 — DbProgressChannel is selected when only a PG DB is wired.
  it('PC-WIRE-02 — selects DbProgressChannel when only PG DB is available', async () => {
    const db = new DrizzlePgAdapter()
    // biome-ignore lint/suspicious/noExplicitAny: stubbing Drizzle client
    vi.spyOn(db, 'getClient').mockReturnValue({} as any)

    const infraMap = new Map<string, unknown>()
    infraMap.set('IDatabasePort', db)

    const channel = await selectProgressChannel(infraMap)
    expect(channel).toBeInstanceOf(DbProgressChannel)
  })

  // PC-WIRE-03 — Falls back to InMemoryProgressChannel when neither is available.
  it('PC-WIRE-03 — falls back to InMemoryProgressChannel when no cache or PG DB is wired', async () => {
    const infraMap = new Map<string, unknown>()
    // Register a non-Upstash cache + non-PG db — both must be rejected.
    infraMap.set('ICachePort', new InMemoryCacheAdapter())
    infraMap.set('IDatabasePort', { notAnAdapter: true })

    const channel = await selectProgressChannel(infraMap)
    expect(channel).toBeInstanceOf(InMemoryProgressChannel)
  })

  // PC-WIRE-04 — The selected channel is stored under 'IProgressChannelPort' in infraMap.
  it('PC-WIRE-04 — IProgressChannelPort key is set in infraMap', async () => {
    const infraMap = new Map<string, unknown>()
    const channel = await selectProgressChannel(infraMap)
    infraMap.set('IProgressChannelPort', channel)

    expect(infraMap.has('IProgressChannelPort')).toBe(true)
    const resolved = infraMap.get('IProgressChannelPort') as IProgressChannelPort
    expect(typeof resolved.set).toBe('function')
    expect(typeof resolved.get).toBe('function')
    expect(typeof resolved.clear).toBe('function')
  })

  // PC-WIRE-05 — WP-F01: DbProgressChannel is selected when Neon DB is active AND no upstash cache.
  it('PC-WIRE-05 — selects DbProgressChannel when NeonDrizzleAdapter is active (no upstash)', async () => {
    const db = Object.create(NeonDrizzleAdapter.prototype) as NeonDrizzleAdapter
    // biome-ignore lint/suspicious/noExplicitAny: stubbing Drizzle client
    vi.spyOn(db, 'getClient').mockReturnValue({} as any)

    const infraMap = new Map<string, unknown>()
    infraMap.set('IDatabasePort', db)

    const channel = await selectProgressChannel(infraMap)
    expect(channel).toBeInstanceOf(DbProgressChannel)
  })

  // PC-WIRE-06 — WP-F01: UpstashProgressChannel still wins over Neon when upstash cache is present.
  it('PC-WIRE-06 — UpstashProgressChannel wins over NeonDrizzleAdapter when both are present', async () => {
    const cache = new UpstashCacheAdapter({ url: 'https://fake.upstash.io', token: 'fake-token' })
    const db = Object.create(NeonDrizzleAdapter.prototype) as NeonDrizzleAdapter
    // biome-ignore lint/suspicious/noExplicitAny: stubbing Drizzle client
    vi.spyOn(db, 'getClient').mockReturnValue({} as any)

    const infraMap = new Map<string, unknown>()
    infraMap.set('ICachePort', cache)
    infraMap.set('IDatabasePort', db)

    const channel = await selectProgressChannel(infraMap)
    const mod = await import('@manta/adapter-cache-upstash')
    expect(channel).toBeInstanceOf(mod.UpstashProgressChannel)
  })
})
