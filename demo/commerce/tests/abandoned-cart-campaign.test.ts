import { describe, expect, it } from 'vitest'
import { runAbandonedCartCampaign } from '../src/utils/abandoned-cart-campaign'
import type { RuntimeNotificationPort, RuntimeSql } from '../src/utils/manta-runtime'

function makeSql() {
  const updates: string[] = []
  const sql = (async (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const query = strings.join('?')
    if (query.includes('FROM carts c') && query.includes('LEFT JOIN contacts')) {
      return [
        {
          id: 'cart_old',
          cart_token: 'tok_old',
          checkout_token: 'checkout_old',
          distinct_id: null,
          email: 'shopper@test.com',
          first_name: 'Alice',
          country_code: 'FR',
          browser_locale: null,
          items: [{ id: 'v1', title: 'Bracelet', quantity: 1 }],
          total_price: 49,
          currency: 'EUR',
          last_action_at: new Date('2026-06-10T10:00:00Z'),
          highest_stage: 'cart',
          contact_id: null,
          contact_locale: null,
          contact_orders_count: 0,
          email_marketing_opt_out_at: null,
          klaviyo_suppressed: false,
        },
      ]
    }
    if (query.includes('FROM abandoned_cart_cases') && query.includes('last_cart_action_at >')) {
      return [{ id: 'cart_new', last_action_at: new Date('2026-06-12T10:00:00Z') }]
    }
    if (query.includes('FROM carts') && query.includes('last_action_at >')) {
      return [{ id: 'cart_new', last_action_at: new Date('2026-06-12T10:00:00Z') }]
    }
    if (query.includes('WITH recovered AS')) return [{ recovered: '0' }]
    if (query.includes('UPDATE abandoned_cart_messages')) {
      updates.push('messages')
      return []
    }
    if (query.includes('UPDATE abandoned_cart_cases')) {
      updates.push('cases')
      return []
    }
    throw new Error(`Unexpected SQL: ${query}`)
  }) as RuntimeSql
  sql.unsafe = async <T = unknown>() => [] as T
  return { sql, updates }
}

describe('runAbandonedCartCampaign supersession', () => {
  it('does not send an older cart sequence when a newer active cart exists for the same email', async () => {
    const { sql, updates } = makeSql()
    const sent: unknown[] = []
    const notification: RuntimeNotificationPort = {
      async send(input) {
        sent.push(input)
        return { status: 'SUCCESS', id: 'msg_1' }
      },
    }

    const result = await runAbandonedCartCampaign({
      sql,
      notification,
      adminBase: 'https://admin.fancypalas.com',
      fromEmail: 'Fancy Palas <hello@fancypalas.com>',
      batchLimit: 10,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    })

    expect(sent).toHaveLength(0)
    expect(result.sent).toBe(0)
    expect(result.skipped).toBe(1)
    expect(updates).toEqual(['messages', 'cases'])
  })
})
