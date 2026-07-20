import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('order_contact replay boundary', () => {
  it('deduplicates existing pairs before enforcing durable uniqueness', async () => {
    const migration = await readFile(
      new URL('../drizzle/migrations/20260720153000_order_contact_unique.sql', import.meta.url),
      'utf8',
    )

    expect(migration).toContain('LOCK TABLE order_contact IN SHARE ROW EXCLUSIVE MODE')
    expect(migration).toContain('DELETE FROM order_contact')
    expect(migration).toContain('UNIQUE INDEX')
    expect(migration).toContain('(order_id, contact_id)')
  })

  it('rolls back only the replay guard and preserves projection history', async () => {
    const rollback = await readFile(
      new URL('../drizzle/migrations/20260720153000_order_contact_unique.down.sql', import.meta.url),
      'utf8',
    )

    expect(rollback).toContain('DROP INDEX IF EXISTS order_contact_active_order_contact_key')
    expect(rollback).not.toContain('DROP TABLE')
    expect(rollback).not.toContain('DELETE FROM')
  })
})
