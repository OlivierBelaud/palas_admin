import { describe, expect, it, vi } from 'vitest'
import {
  compareIdentityResolvers,
  extractIdentitySignals,
  resolveIdentityV2,
  type ContactIdentityRow,
  type IdentityServiceLike,
} from '../src/modules/identity/resolve-event-identity'
import { signContactToken } from '../src/utils/manta-uid'

function services(contacts: ContactIdentityRow[] = [], exchanges: Array<{ exchange_id: string; email: string }> = []) {
  return {
    contact: {
      list: vi.fn(async (filters: Record<string, unknown>) => {
        return contacts.filter((contact) => {
          return Object.entries(filters).every(([key, value]) => (contact as Record<string, unknown>)[key] === value)
        })
      }),
    },
    klaviyoExchangeResolved: {
      list: vi.fn(async (filters: Record<string, unknown>) => {
        return exchanges.filter((row) => row.exchange_id === filters.exchange_id).map((row) => ({ email: row.email }))
      }),
    },
  } satisfies IdentityServiceLike
}

describe('identity shadow resolver', () => {
  it('extracts PostHog identity signals from a checkout event', () => {
    const signals = extractIdentitySignals({
      uuid: 'evt_1',
      event: 'checkout:contact_info_submitted',
      distinct_id: 'ph_1',
      timestamp: '2026-06-09T10:00:00.000Z',
      properties: {
        $session_id: 'sess_1',
        $current_url: 'https://fancypalas.com/checkouts/cn/x?_kx=abc.defghijkl',
        checkout: {
          email: 'Alice@Test.com',
          token: 'chk_1',
          shopify_customer_id: 'cust_1',
        },
        cart: { token: 'cart_1' },
      },
    })

    expect(signals.email).toBe('alice@test.com')
    expect(signals.klaviyo_exchange_id).toBe('abc.defghijkl')
    expect(signals.posthog_distinct_id).toBe('ph_1')
    expect(signals.session_id).toBe('sess_1')
    expect(signals.cart_token).toBe('cart_1')
    expect(signals.checkout_token).toBe('chk_1')
  })

  it('resolves V2 from event email and links an existing contact', async () => {
    const svc = services([{ id: 'contact_1', email: 'alice@test.com', distinct_id: null, shopify_customer_id: null, klaviyo_profile_id: null }])

    const result = await compareIdentityResolvers(
      {
        event: 'checkout:contact_info_submitted',
        distinct_id: 'ph_1',
        properties: { checkout: { email: 'alice@test.com' } },
      },
      svc,
    )

    expect(result.status).toBe('identified')
    expect(result.matched_v1).toBe(true)
    expect(result.v2).toEqual({ email: 'alice@test.com', contact_id: 'contact_1', source: 'event_email' })
  })

  it('resolves V2 from a Manta email token when V1 has no email', async () => {
    process.env.MANTA_UID_SECRET = 'test-secret-for-identity-shadow-resolver'
    const token = signContactToken('alice@test.com')
    const svc = services([{ id: 'contact_1', email: 'alice@test.com', distinct_id: null, shopify_customer_id: null, klaviyo_profile_id: null }])

    const result = await compareIdentityResolvers(
      {
        event: '$pageview',
        distinct_id: 'ph_1',
        properties: { $current_url: `https://fancypalas.com/products/x?u=${encodeURIComponent(token)}` },
      },
      svc,
    )

    expect(result.status).toBe('diverged')
    expect(result.v1.email).toBeNull()
    expect(result.v2).toEqual({ email: 'alice@test.com', contact_id: 'contact_1', source: 'manta_uid_token' })
  })

  it('resolves V2 from local aliases before any external lookup', async () => {
    const svc = services(
      [
        { id: 'contact_distinct', email: 'distinct@test.com', distinct_id: 'ph_known', shopify_customer_id: null, klaviyo_profile_id: null },
        { id: 'contact_klaviyo', email: 'klaviyo@test.com', distinct_id: null, shopify_customer_id: null, klaviyo_profile_id: null },
      ],
      [{ exchange_id: 'kx.token', email: 'klaviyo@test.com' }],
    )

    await expect(
      resolveIdentityV2(
        {
          event_id: null,
          event_name: '$pageview',
          observed_at: new Date().toISOString(),
          posthog_distinct_id: 'ph_known',
          session_id: null,
          current_url: null,
          email: null,
          manta_uid_token: null,
          klaviyo_exchange_id: 'kx.token',
          klaviyo_profile_id: null,
          shopify_customer_id: null,
          cart_token: null,
          checkout_token: null,
        },
        svc,
      ),
    ).resolves.toEqual({ email: 'distinct@test.com', contact_id: 'contact_distinct', source: 'contact_distinct_id' })
  })
})
