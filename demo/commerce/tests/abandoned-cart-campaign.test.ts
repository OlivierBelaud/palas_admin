import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reconcileAbandonedCartRecoveries, runAbandonedCartCampaign } from '../src/utils/abandoned-cart-campaign'
import type { RuntimeNotificationPort, RuntimeSql } from '../src/utils/manta-runtime'

const resolveWelcomeDiscountForEmailMock = vi.hoisted(() =>
  vi.fn(async () => ({
    code: 'PALAS10-TEST',
    source: 'shopify_generated' as const,
    shopifyDiscountId: 'gid://shopify/DiscountCodeNode/test',
  })),
)

vi.mock('../src/utils/discount-codes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/discount-codes')>()
  return {
    ...actual,
    resolveWelcomeDiscountForEmail: resolveWelcomeDiscountForEmailMock,
  }
})

function makeSql() {
  const updates: string[] = []
  const sql = (async (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const query = strings.join('?')
    if (query.includes('FROM carts c') && query.includes('LEFT JOIN LATERAL')) {
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
  beforeEach(() => {
    resolveWelcomeDiscountForEmailMock.mockClear()
  })

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
      if (query.includes('FROM carts c') && query.includes('LEFT JOIN LATERAL')) {
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
      if (query.includes('UPDATE abandoned_cart_cases')) {
        writes.push('case')
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

  it('never resolves or sends a discount when the contact already has orders', async () => {
    vi.stubEnv('SHOPIFY_ADMIN_ACCESS_TOKEN', 'test_token')
    vi.stubEnv('SHOPIFY_SHOP_DOMAIN', 'fancy-palas.myshopify.com')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { orders: { edges: [] } } }),
      })),
    )

    const firstQuery: string[] = []
    const writes: string[] = []
    const sql = (async (strings: TemplateStringsArray, ..._values: unknown[]) => {
      const query = strings.join('?')
      if (query.includes('FROM carts c') && query.includes('LEFT JOIN LATERAL')) {
        firstQuery.push(query)
        return [
          {
            id: 'cart_existing_customer',
            cart_token: 'tok_existing',
            checkout_token: null,
            distinct_id: null,
            email: 'client@test.com',
            first_name: 'Alice',
            country_code: 'FR',
            browser_locale: null,
            items: [{ id: 'v1', title: 'Bracelet', quantity: 1 }],
            total_price: 49,
            currency: 'EUR',
            last_action_at: new Date('2026-06-10T10:00:00Z'),
            highest_stage: 'cart',
            contact_id: 'contact_1',
            contact_locale: 'fr-FR',
            live_orders_count: 1,
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
            id: 'case_existing_customer',
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
            id: 'message_existing_customer',
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
      if (query.includes('FROM klaviyo_events')) return []
      if (query.includes('INSERT INTO abandoned_cart_checks')) {
        writes.push('check')
        return []
      }
      if (query.includes('UPDATE abandoned_cart_cases')) {
        writes.push('case')
        return []
      }
      if (query.includes('UPDATE abandoned_cart_messages')) {
        writes.push('message')
        return []
      }
      if (query.includes('UPDATE carts')) {
        writes.push('cart')
        return []
      }
      if (query.includes('WITH recovered AS')) return [{ recovered: '0' }]
      throw new Error(`Unexpected SQL: ${query}`)
    }) as RuntimeSql
    sql.unsafe = async <T = unknown>() => [] as T

    const sent: Array<{ html?: string; text?: string; tags?: Array<{ name: string; value: string }> }> = []
    const notification: RuntimeNotificationPort = {
      async send(input) {
        sent.push(input)
        return { status: 'SUCCESS', id: 'msg_existing_customer' }
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

    expect(firstQuery[0]).toContain('FROM cart_contact')
    expect(firstQuery[0]).toContain('FROM order_contact')
    expect(resolveWelcomeDiscountForEmailMock).not.toHaveBeenCalled()
    expect(result.sent).toBe(1)
    expect(sent).toHaveLength(1)
    expect(sent[0].html).not.toContain('PALAS10-TEST')
    expect(sent[0].text).not.toContain('PALAS10-TEST')
    expect(sent[0].tags ?? []).not.toEqual(expect.arrayContaining([{ name: 'discount_source', value: 'shopify_generated' }]))
    expect(writes).toContain('message')
    expect(writes).toContain('cart')
  })
})

describe('runAbandonedCartCampaign retries', () => {
  it('retries transient Shopify and email-provider failures with one durable message', async () => {
    vi.stubEnv('SHOPIFY_ADMIN_ACCESS_TOKEN', 'test_token')
    vi.stubEnv('SHOPIFY_SHOP_DOMAIN', 'fancy-palas.myshopify.com')
    let shopifyAttempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        shopifyAttempt += 1
        if (shopifyAttempt === 1) throw new Error('Shopify timeout')
        return {
          ok: true,
          json: async () => ({ data: { orders: { edges: [] } } }),
        }
      }),
    )

    type StoredMessage = {
      id: string
      message_type: 'abandoned_cart_1'
      sequence_version: number
      sequence_started_at: Date
      status: 'pending' | 'sent' | 'skipped' | 'failed'
      sent_at: Date | null
      scheduled_for: Date
    }
    let storedMessage: StoredMessage | null = null
    const sql = (async (strings: TemplateStringsArray, ..._values: unknown[]) => {
      const query = strings.join('?')
      if (query.includes('FROM carts c') && query.includes('LEFT JOIN LATERAL')) {
        return [
          {
            id: 'cart_retry',
            cart_token: 'tok_retry',
            checkout_token: null,
            distinct_id: 'anonymous_retry',
            email: 'retry@test.com',
            first_name: 'Alice',
            country_code: 'FR',
            browser_locale: null,
            items: [{ id: 'v1', title: 'Bracelet', quantity: 1 }],
            total_price: 49,
            currency: 'EUR',
            last_action_at: new Date('2026-07-20T10:00:00Z'),
            highest_stage: 'cart',
            contact_id: null,
            contact_locale: null,
            live_orders_count: 1,
            email_marketing_opt_out_at: null,
            klaviyo_suppressed: false,
          },
        ]
      }
      if (query.includes('last_cart_action_at >') || query.includes('last_action_at >')) return []
      if (query.includes('UPDATE abandoned_cart_cases acc')) {
        return [
          {
            id: 'case_retry',
            status: 'open',
            current_sequence_version: 1,
            sequence_started_at: new Date('2026-07-20T10:00:00Z'),
          },
        ]
      }
      if (query.includes('SELECT MAX(sent_at) AS last_sent_at')) {
        return [{ last_sent_at: storedMessage?.status === 'sent' ? storedMessage.sent_at : null }]
      }
      if (query.includes('SELECT id, message_type') && query.includes('FROM abandoned_cart_messages')) {
        return storedMessage ? [storedMessage] : []
      }
      if (query.includes('INSERT INTO abandoned_cart_messages')) {
        storedMessage = {
          id: 'message_retry',
          message_type: 'abandoned_cart_1',
          sequence_version: 1,
          sequence_started_at: new Date('2026-07-20T10:00:00Z'),
          status: 'pending',
          sent_at: null,
          scheduled_for: new Date('2026-07-20T12:00:00Z'),
        }
        return [storedMessage]
      }
      if (query.includes('FROM orders') && query.includes('placed_at >=')) return []
      if (query.includes('FROM klaviyo_events')) return []
      if (query.includes('INSERT INTO abandoned_cart_checks')) return []
      if (query.includes('UPDATE abandoned_cart_messages') && query.includes('WHERE id =')) {
        if (!storedMessage) throw new Error('message was not created')
        if (query.includes("status = 'sent'")) {
          storedMessage = { ...storedMessage, status: 'sent', sent_at: new Date() }
        } else if (query.includes("status = 'failed'")) {
          storedMessage = { ...storedMessage, status: 'failed' }
        } else if (query.includes("status = 'skipped'")) {
          storedMessage = { ...storedMessage, status: 'skipped' }
        }
        return []
      }
      if (
        query.includes('UPDATE abandoned_cart_messages m') ||
        query.includes('UPDATE abandoned_cart_cases') ||
        query.includes('UPDATE carts')
      ) {
        return []
      }
      if (query.includes('WITH recovered AS')) return [{ recovered: '0' }]
      throw new Error(`Unexpected SQL: ${query}`)
    }) as RuntimeSql
    sql.unsafe = async <T = unknown>() => [] as T

    const deliveries: Array<{ idempotency_key?: string }> = []
    let attempt = 0
    const notification: RuntimeNotificationPort = {
      async send(payload) {
        deliveries.push(payload)
        attempt += 1
        return attempt === 1
          ? { status: 'FAILURE', error: new Error('Resend timeout') }
          : { status: 'SUCCESS', id: 'provider_message_retry' }
      },
    }
    const options = {
      sql,
      notification,
      adminBase: 'https://admin.fancypalas.com',
      fromEmail: 'Fancy Palas <hello@fancypalas.com>',
      batchLimit: 10,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    }

    const shopifyUnavailable = await runAbandonedCartCampaign(options)
    const providerUnavailable = await runAbandonedCartCampaign(options)
    const recoveredRetry = await runAbandonedCartCampaign(options)

    expect(shopifyUnavailable.skipped_shopify_unavailable).toBe(1)
    expect(providerUnavailable.errors).toBe(1)
    expect(recoveredRetry.sent).toBe(1)
    expect(deliveries).toHaveLength(2)
    expect(deliveries[0]?.idempotency_key).toBe('abandoned-cart:abandoned_cart_1:s1:cart_retry')
    expect(deliveries[1]?.idempotency_key).toBe(deliveries[0]?.idempotency_key)
    expect(storedMessage).toMatchObject({ id: 'message_retry', status: 'sent' })
  })
})

describe('reconcileAbandonedCartRecoveries', () => {
  it('only converts open cases and becomes a no-op after the first successful projection', async () => {
    const queries: string[] = []
    let invocation = 0
    const sql = (async (strings: TemplateStringsArray, ..._values: unknown[]) => {
      queries.push(strings.join('?'))
      invocation += 1
      return [{ recovered: invocation === 1 ? '1' : '0' }]
    }) as RuntimeSql
    sql.unsafe = async <T = unknown>() => [] as T

    await expect(reconcileAbandonedCartRecoveries(sql)).resolves.toBe(1)
    await expect(reconcileAbandonedCartRecoveries(sql)).resolves.toBe(0)

    expect(queries).toHaveLength(2)
    expect(queries[0]).toContain("WHERE acc.status = 'open'")
    expect(queries[0]).toContain('SELECT DISTINCT ON (acc.id)')
    expect(queries[0]).toContain("o.status IN ('paid', 'fulfilled')")
  })
})
