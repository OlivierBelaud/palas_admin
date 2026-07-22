import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Klaviyo projection state migration', () => {
  it('persists a singleton success watermark and failure audit', async () => {
    const migration = await readFile(
      new URL('../drizzle/migrations/20260722170000_klaviyo_projection_state.sql', import.meta.url),
      'utf8',
    )

    expect(migration).toContain('klaviyo_projection_state')
    expect(migration).toContain('generation')
    expect(migration).toContain('sync_token')
    expect(migration).toContain('requested_through')
    expect(migration).toContain('last_successful_at')
    expect(migration).toContain('covered_through')
    expect(migration).toContain('last_error')
    expect(migration).toContain('consecutive_failures')
  })

  it('keeps projection audit evidence on rollback', async () => {
    const rollback = await readFile(
      new URL('../drizzle/migrations/20260722170000_klaviyo_projection_state.down.sql', import.meta.url),
      'utf8',
    )

    expect(rollback).not.toContain('DROP TABLE')
    expect(rollback).not.toContain('DELETE FROM')
  })
})
