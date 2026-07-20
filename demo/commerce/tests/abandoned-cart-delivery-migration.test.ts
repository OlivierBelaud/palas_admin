import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('abandoned-cart delivery durability migration', () => {
  it('adds provider facts and an exclusive resumable delivery lease', async () => {
    const migration = await readFile(
      new URL('../drizzle/migrations/20260720170000_abandoned_cart_delivery_lease.sql', import.meta.url),
      'utf8',
    )

    expect(migration).toContain('"provider_status"')
    expect(migration).toContain('"provider_observed_at"')
    expect(migration).toContain('"delivery_claim_token"')
    expect(migration).toContain('"delivery_claimed_at"')
    expect(migration).toContain('"delivery_attempt_count"')
  })

  it('keeps delivery evidence when the migration is rolled back', async () => {
    const rollback = await readFile(
      new URL('../drizzle/migrations/20260720170000_abandoned_cart_delivery_lease.down.sql', import.meta.url),
      'utf8',
    )

    expect(rollback).toContain('DROP INDEX IF EXISTS')
    expect(rollback).not.toContain('DROP COLUMN')
    expect(rollback).not.toContain('DROP TABLE')
    expect(rollback).not.toContain('DELETE FROM')
  })
})
