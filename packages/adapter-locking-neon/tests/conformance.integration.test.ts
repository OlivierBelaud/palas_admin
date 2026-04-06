// NeonLockingAdapter — ILockingPort conformance (requires real PostgreSQL)

import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const SKIP = !process.env.DATABASE_URL

import type { ILockingPort } from '@manta/core'
import { NeonLockingAdapter } from '../src'

describe.skipIf(SKIP)('NeonLockingAdapter — ILockingPort conformance', () => {
  let locking: ILockingPort
  let sql: ReturnType<typeof postgres>

  beforeAll(() => {
    sql = postgres(process.env.DATABASE_URL!, { max: 5 })
  })

  beforeEach(async () => {
    // Release all advisory locks from previous test
    await sql`SELECT pg_advisory_unlock_all()`
    locking = new NeonLockingAdapter(sql as any)
  })

  afterAll(async () => {
    await sql`SELECT pg_advisory_unlock_all()`
    await sql.end()
  })

  it('L-02 — execute returns result', async () => {
    const result = await locking.execute(['lock-1'], async () => 42)
    expect(result).toBe(42)
  })

  it('L-03 — execute propagates error', async () => {
    await expect(
      locking.execute(['lock-1'], async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })

  it('L-04 — acquire/release lifecycle', async () => {
    const first = await locking.acquire('lock-1')
    expect(first).toBe(true)

    await locking.release('lock-1')

    const second = await locking.acquire('lock-1')
    expect(second).toBe(true)
    await locking.release('lock-1')
  })
})
