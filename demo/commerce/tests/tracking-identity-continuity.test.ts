import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { normalizePosthogEventToCanonical } from '../src/modules/event-hub/canonical-posthog'
import { mapCanonicalToGa4 } from '../src/modules/event-hub/ga4-connector'
import { mapCanonicalToMetaCapi } from '../src/modules/event-hub/meta-capi-connector'
import { mapCanonicalToPinterest } from '../src/modules/event-hub/pinterest-connector'
import type { IdentityShadowComparison } from '../src/modules/identity/resolve-event-identity'

const session = '01a0e782-1cac-7790-95c0-8bd3cfdb5768'
const consent = { analytics_storage: true, ad_storage: true, ad_user_data: true, ad_personalization: true }
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
function canonical(name: string, properties: Record<string, unknown> = {}, identified = false) {
  const resolved = {
    email: identified ? ' Jean.Dupont+shop@gmail.com ' : null,
    contact_id: identified ? 'contact_1' : null,
    source: identified ? 'contact_distinct_id' : null,
  }
  const comparison = {
    signals: {
      event_id: `event_${name}`,
      event_name: name,
      observed_at: '2026-09-28T10:14:27.000Z',
      posthog_distinct_id: 'browser_1',
      session_id: session,
      current_url: 'https://fancypalas.com/fr',
    },
    v1: resolved,
    v2: resolved,
    status: identified ? 'identified' : 'anonymous',
    matched_v1: true,
    aliases_seen: {},
    evidence: {},
  } as IdentityShadowComparison
  return normalizePosthogEventToCanonical(
    { event: name, properties: { consent, muid: name === '$pageview' ? 'muid_old' : 'muid_new', ...properties } },
    comparison,
    {},
    { user_agent: 'Test browser', client_ip: '203.0.113.10' },
  )!.payload_normalized
}

describe('one visitor across page, cart and identification', () => {
  it('does not change GA4 client identity when legacy MUID differs by event', () => {
    const page = canonical('$pageview')
    const cart = canonical(
      'cart:product_added',
      { ecommerce: { value: 55, currency: 'EUR', items: [{ item_id: '1', price: 55, quantity: 1 }] } },
      true,
    )
    expect(mapCanonicalToGa4('page_view', page).payload.client_id).toBe(
      mapCanonicalToGa4('add_to_cart', cart).payload.client_id,
    )
  })
  it('preserves the PostHog session as a stable numeric GA4 fallback with explicit provenance', () => {
    const page = canonical('$pageview')
    const ga = mapCanonicalToGa4('page_view', page)
    expect(ga.payload).toMatchObject({
      events: [
        { params: { session_id: Math.floor(Number.parseInt(session.replaceAll('-', '').slice(0, 12), 16) / 1000) } },
      ],
    })
    expect(page.user).toMatchObject({ ga_session_id_source: 'posthog_session', ga_client_id_source: 'posthog_visitor' })
  })
  it('uses native GA4 identity and its own session when supplied', () => {
    const page = canonical('$pageview', { ga_client_id: '123.456', ga_session_id: '1790589000' })
    expect(mapCanonicalToGa4('page_view', page).payload).toMatchObject({
      client_id: '123.456',
      events: [{ params: { session_id: 1790589000 } }],
    })
  })
  it('does not invent a native Google session from a PostHog session', () => {
    const page = canonical('$pageview', { ga_client_id: '123.456' })
    expect(page.user).toMatchObject({ ga_session_id: null, ga_session_id_source: 'missing' })
    const events = mapCanonicalToGa4('page_view', page).payload.events as Array<{ params: Record<string, unknown> }>
    expect(events[0].params.session_id).toBeUndefined()
  })
  it('keeps browser identity in Meta and Pinterest when a customer becomes known', () => {
    for (const map of [mapCanonicalToMetaCapi, mapCanonicalToPinterest]) {
      const before = map('page_view', canonical('$pageview')).payload as {
        data: Array<{ user_data: { external_id: string[] } }>
      }
      const after = map('page_view', canonical('$pageview', {}, true)).payload as {
        data: Array<{ user_data: { external_id: string[] } }>
      }
      const id = hash('browser_1')
      expect(before.data[0].user_data.external_id).toContain(id)
      expect(after.data[0].user_data.external_id).toContain(id)
    }
  })
  it('normalizes Gmail for Google without changing the shared CRM/Meta email hash', () => {
    expect(canonical('$pageview', {}, true).user).toMatchObject({
      email_sha256: hash('jean.dupont+shop@gmail.com'),
      google_email_sha256: hash('jeandupont@gmail.com'),
    })
  })
  it('does not send a GA4 identified event when analytics consent was denied or unknown', () => {
    for (const consent of [{ analytics_storage: false }, {}]) {
      const mapped = mapCanonicalToGa4('page_view', canonical('$pageview', { consent }, true))
      expect(mapped.ok).toBe(false)
    }
  })
})
