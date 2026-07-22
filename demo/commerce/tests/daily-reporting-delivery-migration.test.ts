import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('daily reporting delivery durability migration', () => {
  it('adds a per-recipient ledger with an exclusive resumable lease', async () => {
    const migration = await readFile(
      new URL('../drizzle/migrations/20260722180000_reporting_daily_deliveries.sql', import.meta.url),
      'utf8',
    )

    expect(migration).toContain('reporting_daily_deliveries')
    expect(migration).toContain('idempotency_key')
    expect(migration).toContain('content_payload')
    expect(migration).toContain('claim_token')
    expect(migration).toContain('claim_expires_at')
    expect(migration).toContain('attempt_count')
    expect(migration).toContain('next_attempt_at')
    expect(migration).toContain('reporting_daily_deliveries_retry_due_idx')
    expect(migration).not.toContain('orders_reporting_eligible_placed_at_idx')
    expect(migration).not.toContain('visitor_sessions_reporting_email_message_idx')
  })

  it('keeps financial delivery evidence on rollback', async () => {
    const rollback = await readFile(
      new URL('../drizzle/migrations/20260722180000_reporting_daily_deliveries.down.sql', import.meta.url),
      'utf8',
    )

    expect(rollback).not.toContain('DROP INDEX')
    expect(rollback).not.toContain('DROP TABLE')
    expect(rollback).not.toContain('DELETE FROM')
  })
})
