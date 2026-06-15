import { describe, expect, it } from 'vitest'
import { type ContactRecord, normalizeContactEmail, planContactMerge } from '../src/modules/contact/merge-contact'

function baseContact(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    email: 'jane@example.com',
    phone: null,
    locale: 'fr-FR',
    first_name: null,
    last_name: null,
    country_code: null,
    city: null,
    shopify_customer_id: null,
    klaviyo_profile_id: null,
    distinct_id: null,
    klaviyo_subscribed: false,
    klaviyo_suppressed: false,
    email_marketing_opt_out_at: null,
    shopify_synced_at: null,
    klaviyo_synced_at: null,
    last_activity_at: null,
    ...overrides,
  }
}

describe('normalizeContactEmail', () => {
  it('lowercases and trims email keys', () => {
    expect(normalizeContactEmail(' Jane@Example.COM ')).toBe('jane@example.com')
  })

  it('returns null for empty values', () => {
    expect(normalizeContactEmail('   ')).toBe(null)
    expect(normalizeContactEmail(null)).toBe(null)
  })
})

describe('planContactMerge', () => {
  it('creates an identity-only contact patch from a Shopify customer signal', () => {
    const plan = planContactMerge(null, {
      source: 'shopify',
      source_kind: 'shopify_customer',
      source_id: '123',
      occurred_at: '2026-05-19T10:00:00.000Z',
      email: 'Jane@Example.com',
      first_name: 'Jane',
      locale: 'fr',
      shopify_customer_id: '123',
    })

    expect(plan.creates_contact).toBe(true)
    expect(plan.email_key).toBe('jane@example.com')
    expect(plan.patch.email).toBe('jane@example.com')
    expect(plan.patch.locale).toBe('fr')
    expect(plan.patch.shopify_customer_id).toBe('123')
    expect(plan.changed_fields).toContain('shopify_synced_at')
  })

  it('does not overwrite Shopify identity with a conflicting Shopify id silently', () => {
    const plan = planContactMerge(baseContact({ shopify_customer_id: 'old-shopify-id' }), {
      source: 'shopify',
      source_kind: 'shopify_customer',
      source_id: 'new-shopify-id',
      occurred_at: '2026-05-19T10:00:00.000Z',
      email: 'jane@example.com',
      shopify_customer_id: 'new-shopify-id',
    })

    expect(plan.patch.shopify_customer_id).toBeUndefined()
    expect(plan.ignored_fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'shopify_customer_id',
          reason: 'identity_conflict',
        }),
      ]),
    )
  })

  it('lets PostHog navigation update locale', () => {
    const plan = planContactMerge(baseContact({ locale: 'en' }), {
      source: 'posthog',
      source_kind: 'posthog_navigation',
      occurred_at: '2026-05-19T10:00:00.000Z',
      email: 'jane@example.com',
      locale: 'fr',
    })

    expect(plan.patch.locale).toBe('fr')
  })

  it('does not let a lower-priority Klaviyo profile overwrite a known phone', () => {
    const plan = planContactMerge(baseContact({ phone: '+33600000000' }), {
      source: 'klaviyo',
      source_kind: 'klaviyo_profile',
      occurred_at: '2026-05-19T10:00:00.000Z',
      email: 'jane@example.com',
      phone: '+33711111111',
    })

    expect(plan.patch.phone).toBeUndefined()
    expect(plan.ignored_fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'phone',
          reason: 'lower_priority_profile_source',
        }),
      ]),
    )
  })

  it('keeps Palas opt-out once set', () => {
    const plan = planContactMerge(baseContact({ email_marketing_opt_out_at: '2026-05-01T00:00:00.000Z' }), {
      source: 'palas',
      source_kind: 'palas_unsubscribe',
      occurred_at: '2026-05-19T10:00:00.000Z',
      email: 'jane@example.com',
      email_marketing_opt_out_at: '2026-05-19T10:00:00.000Z',
    })

    expect(plan.patch.email_marketing_opt_out_at).toBeUndefined()
    expect(plan.ignored_fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'email_marketing_opt_out_at',
          reason: 'existing_value_wins',
        }),
      ]),
    )
  })
})
