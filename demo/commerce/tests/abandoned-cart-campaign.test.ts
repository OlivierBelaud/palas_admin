import { afterEach, describe, expect, it, vi } from 'vitest'
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
          live_orders_count: 0,
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

describe('runAbandonedCartCampaign guard checks', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('blocks natively when Klaviyo already sent an abandonment email for the cart window', async () => {
    vi.stubEnv('SHOPIFY_ADMIN_ACCESS_TOKEN', 'test_token')
    vi.stubEnv('SHOPIFY_SHOP_DOMAIN', 'fancy-palas.myshopify.com')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { orders: { edges: [] } } }),
      })),
    )

    const writes: string[] = []
    const sql = (async (strings: TemplateStringsArray, ..._values: unknown[]) => {
      const query = strings.join('?')
      if (query.includes('FROM carts c') && query.includes('LEFT JOIN contacts')) {
        return [
          {
            id: 'cart_1',
            cart_token: 'tok_1',
            checkout_token: null,
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
            live_orders_count: 0,
            email_marketing_opt_out_at: null,
            klaviyo_suppressed: false,
          },
        ]
      }
      if (query.includes('last_cart_action_at >') || query.includes('last_action_at >')) return []
      if (query.includes('UPDATE abandoned_cart_cases acc')) return []
      if (query.includes('INSERT INTO abandoned_cart_cases')) {
        return [
          {
            id: 'case_1',
            status: 'open',
            current_sequence_version: 1,
            sequence_started_at: new Date('2026-06-10T10:00:00Z'),
          },
        ]
      }
      if (query.includes('SELECT MAX(sent_at) AS last_sent_at')) return [{ last_sent_at: null }]
      if (query.includes('SELECT id, message_type') && query.includes('FROM abandoned_cart_messages')) return []
      if (query.includes('INSERT INTO abandoned_cart_messages')) {
        return [
          {
            id: 'message_1',
            message_type: 'abandoned_cart_1',
            sequence_version: 1,
            sequence_started_at: new Date('2026-06-10T10:00:00Z'),
            status: 'pending',
            sent_at: null,
            scheduled_for: new Date('2026-06-10T12:00:00Z'),
          },
        ]
      }
      if (query.includes('FROM orders') && query.includes('placed_at >=')) return []
      if (query.includes('FROM klaviyo_events')) return [{ occurred_at: new Date('2026-06-10T12:15:00Z') }]
      if (query.includes('INSERT INTO abandoned_cart_checks')) {
        writes.push('check')
        return []
      }
      if (query.includes('UPDATE abandoned_cart_messages')) {
        writes.push('message')
        return []
      }
      if (query.includes('UPDATE abandoned_cart_cases')) {
        writes.push('case')
        return []
      }
      if (query.includes('WITH recovered AS')) return [{ recovered: '0' }]
      throw new Error(`Unexpected SQL: ${query}`)
    }) as RuntimeSql
    sql.unsafe = async <T = unknown>() => [] as T

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
    expect(result.skipped_klaviyo).toBe(1)
    expect(writes).toContain('check')
    expect(writes).toContain('message')
  })
})
