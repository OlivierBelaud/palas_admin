import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getPinterestConfig,
  isPinterestConfigured,
  mapCanonicalToPinterest,
  pinterestDestinationConnector,
  sendPinterestPayload,
} from '../src/modules/event-hub/pinterest-connector'

const purchase = {
  event_id: 'evt_purchase_1',
  event_time: '2026-09-25T10:11:12.000Z',
  user: {
    muid: 'customer_123',
    email_sha256: 'A'.repeat(64),
    epik: 'pinterest_click_123',
    client_ip: '203.0.113.10',
    user_agent: 'Mozilla/5.0 Test Browser',
  },
  consent: { ad_storage: true, ad_user_data: true, ad_personalization: true },
  context: { url: 'https://fancypalas.com/thank-you' },
  ecommerce: {
    currency: 'EUR',
    value: 150,
    transaction_id: 'order_123',
    items: [{ item_id: 'variant_1', item_name: 'Bague', price: 75, quantity: 2 }],
  },
}
const config = getPinterestConfig({ PINTEREST_AD_ACCOUNT_ID: '123456789', PINTEREST_ACCESS_TOKEN: 'secret_token' })
const accepted = { num_events_received: 1, num_events_processed: 1, events: [{ status: 'processed' }] }
const mappedPayload = () => mapCanonicalToPinterest('purchase', purchase).payload
const response = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))

afterEach(() => vi.unstubAllGlobals())

describe('Pinterest canonical mapping', () => {
  it('maps a purchase exactly to the v5 API schema without raw identifiers', () => {
    const result = mapCanonicalToPinterest('purchase', purchase)
    expect(result.ok).toBe(true)
    expect(result.payload).toEqual({
      data: [
        {
          event_name: 'checkout',
          event_id: 'evt_purchase_1',
          event_time: 1_790_331_072,
          action_source: 'web',
          event_source_url: 'https://fancypalas.com/thank-you',
          user_data: {
            em: ['a'.repeat(64)],
            external_id: [createHash('sha256').update('customer_123').digest('hex')],
            click_id: 'pinterest_click_123',
            client_ip_address: '203.0.113.10',
            client_user_agent: 'Mozilla/5.0 Test Browser',
          },
          custom_data: {
            currency: 'EUR',
            value: '150',
            order_id: 'order_123',
            content_ids: ['variant_1'],
            contents: [{ id: 'variant_1', item_name: 'Bague', item_price: '75', quantity: 2 }],
            num_items: 2,
          },
        },
      ],
    })
    expect(JSON.stringify(result.metadata)).not.toContain('customer_123')
    expect(JSON.stringify(result.metadata)).not.toContain('pinterest_click_123')
  })

  it.each([
    ['page_view', 'page_visit'],
    ['view_item', 'page_visit'],
    ['view_item_list', 'view_category'],
    ['add_to_cart', 'add_to_cart'],
    ['begin_checkout', 'initiate_checkout'],
    ['add_payment_info', 'add_payment_info'],
    ['search', 'search'],
  ])('maps %s to its matching standard %s', (name, expected) => {
    expect(mapCanonicalToPinterest(name, { ...purchase, search_term: 'rings' })).toMatchObject({
      ok: true,
      payload: { data: [{ event_name: expected }] },
    })
  })

  it.each([
    'cart:updated',
    'cart:closed',
    'checkout:address_info_submitted',
    'remove_from_cart',
    'add_contact_info',
  ])('does not manufacture semantics for %s', (name) => {
    expect(mapCanonicalToPinterest(name, purchase)).toMatchObject({ supported: false, ok: false, payload: {} })
  })

  it.each(['ad_storage', 'ad_user_data', 'ad_personalization'])('requires explicit %s consent', (key) => {
    for (const value of [false, undefined, 'true']) {
      const result = mapCanonicalToPinterest('purchase', {
        ...purchase,
        consent: { ...purchase.consent, [key]: value },
      })
      expect(result).toMatchObject({ ok: false, payload: {}, errors: [`pinterest_${key}_consent_not_granted`] })
    }
  })

  it.each([
    undefined,
    '',
    'invalid',
    '1',
    '2026',
    0,
    -1,
    true,
  ])('rejects invalid event time %s instead of using now', (event_time) => {
    expect(mapCanonicalToPinterest('purchase', { ...purchase, event_time })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['pinterest_event_time_invalid']),
    })
  })

  it.each([undefined, '', ' ', 42])('requires a stable event id %s', (event_id) => {
    expect(mapCanonicalToPinterest('purchase', { ...purchase, event_id })).toMatchObject({ ok: false })
  })

  it.each([
    null,
    '',
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    false,
    'invalid',
  ])('rejects invalid purchase value %s', (value) => {
    expect(
      mapCanonicalToPinterest('purchase', { ...purchase, ecommerce: { ...purchase.ecommerce, value } }),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['pinterest_value_invalid']),
    })
  })

  it('requires currency, order and valid product quantities', () => {
    const result = mapCanonicalToPinterest('purchase', {
      ...purchase,
      ecommerce: { value: 10, currency: 'EU', items: [{ item_id: 'a', quantity: -1 }] },
    })
    expect(result).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        'pinterest_currency_invalid',
        'pinterest_order_id_missing',
        'pinterest_item_quantity_invalid',
      ]),
    })
  })

  it('accepts zero revenue and rejects missing source URLs', () => {
    expect(
      mapCanonicalToPinterest('purchase', { ...purchase, ecommerce: { ...purchase.ecommerce, value: 0 } }).ok,
    ).toBe(true)
    expect(mapCanonicalToPinterest('page_view', { ...purchase, context: {} }).ok).toBe(false)
  })

  it('hashes normalized email once, preserves hashed external ids, and requires email or valid IP + UA', () => {
    const result = mapCanonicalToPinterest('page_view', {
      ...purchase,
      user: { email: ' Person@Example.Com ', external_id: 'b'.repeat(64) },
    })
    expect(result).toMatchObject({
      ok: true,
      payload: {
        data: [
          {
            user_data: {
              em: [createHash('sha256').update('person@example.com').digest('hex')],
              external_id: ['b'.repeat(64)],
            },
          },
        ],
      },
    })
    expect(mapCanonicalToPinterest('page_view', { ...purchase, user: { epik: 'click', muid: 'person' } }).ok).toBe(
      false,
    )
    expect(
      mapCanonicalToPinterest('page_view', { ...purchase, user: { client_ip: 'invalid', user_agent: 'browser' } }).ok,
    ).toBe(false)
    expect(
      mapCanonicalToPinterest('page_view', { ...purchase, user: { client_ip: '203.0.113.10', user_agent: 'browser' } })
        .ok,
    ).toBe(true)
  })
})

describe('Pinterest transport', () => {
  it('defaults to live mode and rejects absent or malformed credentials without sending', async () => {
    const fetchMock = response(accepted)
    vi.stubGlobal('fetch', fetchMock)
    expect(config.testMode).toBe(false)
    for (const env of [
      {},
      { PINTEREST_AD_ACCOUNT_ID: '../other', PINTEREST_ACCESS_TOKEN: 'token' },
      { PINTEREST_AD_ACCOUNT_ID: '123', PINTEREST_ACCESS_TOKEN: ' ' },
    ]) {
      const missing = getPinterestConfig(env)
      expect(isPinterestConfigured(missing)).toBe(false)
      expect((await sendPinterestPayload(mappedPayload(), missing)).status).toBe('not_configured')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts the exact mapped body with bearer token and propagates abort signal', async () => {
    const fetchMock = response(accepted)
    vi.stubGlobal('fetch', fetchMock)
    const payload = mappedPayload()
    const signal = new AbortController().signal
    expect(await sendPinterestPayload(payload, config, signal)).toMatchObject({ status: 'sent', http_status: 200 })
    expect(fetchMock).toHaveBeenCalledWith('https://api.pinterest.com/v5/ad_accounts/123456789/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret_token' },
      body: JSON.stringify(payload),
      signal,
    })
    expect(pinterestDestinationConnector.destination).toBe('pinterest')
  })

  it('records test requests as validated rather than sent', async () => {
    const fetchMock = response(accepted)
    vi.stubGlobal('fetch', fetchMock)
    const testConfig = getPinterestConfig({
      PINTEREST_AD_ACCOUNT_ID: '123',
      PINTEREST_ACCESS_TOKEN: 'token',
      PINTEREST_TEST_MODE: 'true',
    })
    expect((await sendPinterestPayload(mappedPayload(), testConfig)).status).toBe('validated')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.pinterest.com/v5/ad_accounts/123/events?test=true')
  })

  it.each([
    {},
    '',
    'not JSON',
    { num_events_received: 1, num_events_processed: 1 },
    { ...accepted, num_events_processed: 0 },
    { ...accepted, events: [{ status: 'unknown' }] },
    { ...accepted, events: [{ status: 'processed', error_message: { malformed: true } }] },
    { ...accepted, events: [null] },
  ])('retries an ambiguous success response with the original event identity', async (body) => {
    const fetchMock = response(body)
    vi.stubGlobal('fetch', fetchMock)
    const payload = mappedPayload()
    const first = await sendPinterestPayload(payload, config)
    expect(first).toMatchObject({ status: 'retry', error_code: 'pinterest_events_not_accepted' })
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(accepted), { status: 200 }))
    expect((await sendPinterestPayload(payload, config)).status).toBe('sent')
    expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).data[0].event_id).toBe('evt_purchase_1')
  })

  it.each([
    { ...accepted, events: [{ status: 'failed', error_message: 'raw_person@example.com secret_token' }] },
    { ...accepted, events: [{ status: 'failed' }] },
    { ...accepted, events: [{ status: 'processed', error_message: 'rejected' }] },
  ])('keeps explicit per-event failures terminal without retaining provider details', async (body) => {
    vi.stubGlobal('fetch', response(body))
    const result = await sendPinterestPayload(mappedPayload(), config)
    expect(result.status).toBe('error')
    expect(JSON.stringify(result)).not.toContain('raw_person@example.com')
    expect(JSON.stringify(result)).not.toContain('secret_token')
  })

  it('rejects partial batch success and strips warnings and arbitrary fields from response logs', async () => {
    vi.stubGlobal(
      'fetch',
      response({
        num_events_received: 2,
        num_events_processed: 1,
        events: [{ status: 'processed' }, { status: 'failed', error_message: 'person@example.com' }],
        token: 'secret_token',
      }),
    )
    const result = await sendPinterestPayload(
      { data: [...(mappedPayload().data as unknown[]), ...(mappedPayload().data as unknown[])] },
      config,
    )
    expect(result.status).toBe('error')
    expect(JSON.stringify(result)).not.toContain('person@example.com')
    expect(JSON.stringify(result)).not.toContain('secret_token')
    vi.stubGlobal(
      'fetch',
      response({ ...accepted, events: [{ status: 'processed', warning_message: 'person@example.com' }] }),
    )
    expect(await sendPinterestPayload(mappedPayload(), config)).toEqual({
      status: 'sent',
      http_status: 200,
      error_code: null,
      error_message: null,
      response_payload: { num_events_received: 1, num_events_processed: 1, events: [{ status: 'processed' }] },
    })
  })

  it.each([429, 500, 503])('retries transient HTTP %s without echoing provider details', async (status) => {
    vi.stubGlobal('fetch', response({ message: 'secret_token raw_person@example.com' }, status))
    const result = await sendPinterestPayload(mappedPayload(), config)
    expect(result).toMatchObject({ status: 'retry', http_status: status })
    expect(JSON.stringify(result)).not.toContain('secret_token')
    expect(JSON.stringify(result)).not.toContain('raw_person@example.com')
  })

  it('makes auth failures terminal and sanitizes thrown network errors', async () => {
    vi.stubGlobal('fetch', response({ message: 'secret_token' }, 401))
    expect((await sendPinterestPayload(mappedPayload(), config)).status).toBe('error')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret_token person@example.com')))
    expect(await sendPinterestPayload(mappedPayload(), config)).toMatchObject({
      status: 'retry',
      error_message: 'Pinterest request failed',
    })
  })

  it('rejects empty data before any request', async () => {
    const fetchMock = response(accepted)
    vi.stubGlobal('fetch', fetchMock)
    expect((await sendPinterestPayload({}, config)).status).toBe('invalid')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries a network failure while reading a successful response body', async () => {
    const rejected = () => Promise.reject(new TypeError('connection closed secret_token'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: rejected, json: rejected }))
    expect(await sendPinterestPayload(mappedPayload(), config)).toMatchObject({
      status: 'retry',
      error_message: 'Pinterest request failed',
    })
  })
})
