import { describe, expect, it, vi } from 'vitest'
import { fenceDeliveryAgainstKlaviyoProjection } from '../abandoned-cart-campaign'
import type { RuntimeSql } from '../manta-runtime'

const projection = {
  generation: 7,
  syncToken: 'sync_7',
  throughIso: '2026-07-22T17:00:00.000Z',
}

function instrumentedSql(authorized: boolean) {
  let query = ''
  let params: unknown[] = []
  const sql = (async () => []) as unknown as RuntimeSql
  sql.unsafe = async <T>(statement: string, values: unknown[] = []) => {
    query = statement
    params = values
    return (authorized ? [{ id: 'message_1' }] : []) as T
  }
  return { sql, read: () => ({ query, params }) }
}

describe('Klaviyo delivery fence', () => {
  it.each([
    'successor claim',
    'projection syncing',
    'projection failed',
    'projection stale',
    'event inserted after precheck',
  ])('blocks the provider when the atomic fence rejects: %s', async () => {
    const { sql } = instrumentedSql(false)
    const provider = vi.fn()

    const authorized = await fenceDeliveryAgainstKlaviyoProjection(
      sql,
      { messageId: 'message_1', claimToken: 'claim_original' },
      projection,
      'shopper@test.com',
      new Date('2026-07-22T15:00:00.000Z'),
    )
    if (authorized) await provider()

    expect(authorized).toBe(false)
    expect(provider).not.toHaveBeenCalled()
  })

  it('refreshes the claim and validates the exact generation before allowing the provider', async () => {
    const { sql, read } = instrumentedSql(true)
    const order: string[] = []

    const authorized = await fenceDeliveryAgainstKlaviyoProjection(
      sql,
      { messageId: 'message_1', claimToken: 'claim_original' },
      projection,
      'shopper@test.com',
      new Date('2026-07-22T15:00:00.000Z'),
    )
    order.push('fence')
    if (authorized) order.push('provider')

    const { query, params } = read()
    expect(order).toEqual(['fence', 'provider'])
    expect(query).toContain('message.delivery_claim_token = $2')
    expect(query).toContain("projection.status = 'succeeded'")
    expect(query).toContain('projection.generation = $4')
    expect(query).toContain('projection.sync_token = $5')
    expect(query).toContain('projection.covered_through = $6::timestamptz')
    expect(query).toContain('projection.requested_through = projection.covered_through')
    expect(query).toContain('projection.covered_through >= NOW()')
    expect(query).toContain('NOT EXISTS')
    expect(query).toContain('event.metric = ANY($10::text[])')
    expect(query).toContain("event.metric = 'Received Email'")
    expect(params.slice(0, 6)).toEqual([
      'message_1',
      'claim_original',
      'abandonment_events',
      7,
      'sync_7',
      projection.throughIso,
    ])
  })
})
