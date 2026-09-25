import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getGoogleAdsConfig,
  isGoogleAdsConfigured,
  mapCanonicalToGoogleAds,
  sendGoogleAdsPurchasePayload,
} from '../src/modules/event-hub/google-ads-connector'

const config = getGoogleAdsConfig({
  GOOGLE_ADS_CLIENT_ID: 'client',
  GOOGLE_ADS_CLIENT_SECRET: 'secret',
  GOOGLE_ADS_REFRESH_TOKEN: 'refresh',
  GOOGLE_ADS_CUSTOMER_ID: '123-456-7890',
  GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID: '987654321',
})
const purchasePayload = {
  event_id: 'event_123',
  event_time: '2026-06-12T10:11:12.000Z',
  user: { gclid: 'gclid_123', email_sha256: 'a'.repeat(64), phone_sha256: 'b'.repeat(64) },
  consent: { ad_user_data: true, ad_storage: true, ad_personalization: true },
  context: { url: 'https://fancypalas.com/thank-you' },
  ecommerce: { currency: 'EUR', value: 150, transaction_id: 'order_123' },
}
const expectedBody = {
  destinations: [
    { operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '1234567890' }, productDestinationId: '987654321' },
  ],
  events: [
    {
      eventTimestamp: '2026-06-12T10:11:12.000Z',
      transactionId: 'order_123',
      conversionValue: 150,
      currency: 'EUR',
      eventSource: 'WEB',
      adIdentifiers: { gclid: 'gclid_123' },
      userData: { userIdentifiers: [{ emailAddress: 'a'.repeat(64) }, { phoneNumber: 'b'.repeat(64) }] },
    },
  ],
  consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' },
  encoding: 'HEX',
  validateOnly: false,
}
const body = () => mapCanonicalToGoogleAds('purchase', purchasePayload, config).payload
function stubResponses(status: number, response: unknown) {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access' }), { status: 200 }))
    .mockResolvedValueOnce(new Response(typeof response === 'string' ? response : JSON.stringify(response), { status }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Google Ads Data Manager mapping', () => {
  it.each([
    ['add_to_cart', '7795313739'],
    ['begin_checkout', '7795331743'],
    ['add_contact_info', '7795191722'],
    ['add_shipping_info', '7795323285'],
    ['add_payment_info', '7795326363'],
    ['purchase', '7795320871'],
  ])('routes Palas %s without conversion-action environment variables', (name, actionId) => {
    const defaults = getGoogleAdsConfig({ GOOGLE_ADS_CUSTOMER_ID: '1234567890' })
    expect(mapCanonicalToGoogleAds(name, purchasePayload, defaults)).toMatchObject({
      ok: true,
      payload: { destinations: [{ productDestinationId: actionId }] },
    })
    expect(isGoogleAdsConfigured(defaults)).toBe(false)
  })
  it('maps exact Data Manager schema and uses existing OAuth config without a developer token', () => {
    expect(isGoogleAdsConfigured(config)).toBe(true)
    expect(config.endpoint).toBe('https://datamanager.googleapis.com/v1')
    expect(body()).toEqual(expectedBody)
  })
  it('retains unsupported-event behavior', () => {
    expect(mapCanonicalToGoogleAds('view_item', purchasePayload, config)).toMatchObject({ supported: false, ok: false })
  })
  it.each([
    ['add_to_cart', 'addToCartConversionActionId'],
    ['begin_checkout', 'beginCheckoutConversionActionId'],
    ['add_contact_info', 'leadConversionActionId'],
    ['add_shipping_info', 'addShippingInfoConversionActionId'],
    ['add_payment_info', 'addPaymentInfoConversionActionId'],
  ])('uses action and stable canonical event id for %s', (name, field) => {
    const mapped = mapCanonicalToGoogleAds(name, purchasePayload, { ...config, [field]: '111222333' })
    expect(mapped.ok).toBe(true)
    expect(mapped.payload).toMatchObject({
      destinations: [{ productDestinationId: '111222333' }],
      events: [{ transactionId: 'event_123' }],
    })
  })
  it('distinguishes missing configuration from payload errors', () => {
    const mapped = mapCanonicalToGoogleAds('purchase', purchasePayload, {
      ...config,
      customerId: null,
      purchaseConversionActionId: null,
    })
    expect(mapped).toMatchObject({
      ok: false,
      metadata: {
        configuration_errors: ['google_ads_customer_id_missing', 'google_ads_conversion_action_id_missing'],
        payload_errors: [],
      },
    })
  })
  it.each(['ad_storage', 'ad_user_data', 'ad_personalization'])('requires strict true for %s', (key) => {
    for (const value of [false, undefined, 'true', 1]) {
      const mapped = mapCanonicalToGoogleAds(
        'purchase',
        { ...purchasePayload, consent: { ...purchasePayload.consent, [key]: value } },
        config,
      )
      expect(mapped).toMatchObject({
        ok: false,
        errors: expect.arrayContaining([`google_ads_${key}_consent_not_granted`]),
      })
    }
  })
  it.each([
    undefined,
    '',
    'not-a-date',
    '2026-02-30T00:00:00Z',
    '2026-06-12T24:00:00Z',
  ])('rejects absent or invalid event time %s', (event_time) => {
    expect(mapCanonicalToGoogleAds('purchase', { ...purchasePayload, event_time }, config).ok).toBe(false)
  })
  it.each([null, '', '   ', true, -1, Infinity, NaN])('rejects invalid monetary values %s', (value) => {
    expect(
      mapCanonicalToGoogleAds(
        'purchase',
        { ...purchasePayload, ecommerce: { ...purchasePayload.ecommerce, value } },
        config,
      ).ok,
    ).toBe(false)
  })
  it('rejects missing purchase transaction, identity, currency and non-purchase event id', () => {
    expect(
      mapCanonicalToGoogleAds(
        'purchase',
        { ...purchasePayload, user: {}, ecommerce: { value: 12, currency: 'euro' } },
        config,
      ),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        'google_ads_order_id_missing',
        'google_ads_identifier_missing',
        'google_ads_currency_code_missing',
      ]),
    })
    expect(
      mapCanonicalToGoogleAds(
        'add_to_cart',
        { ...purchasePayload, event_id: undefined },
        { ...config, addToCartConversionActionId: '123' },
      ).ok,
    ).toBe(false)
  })
  it.each(['gbraid', 'wbraid'])('accepts URL %s without leaking context', (key) => {
    expect(
      mapCanonicalToGoogleAds(
        'purchase',
        { ...purchasePayload, user: {}, context: { url: `https://fancypalas.com/?${key}=click` } },
        config,
      ).payload,
    ).toMatchObject({ events: [{ adIdentifiers: { [key]: 'click' } }] })
  })
})

describe('Google Ads Data Manager transport', () => {
  it('refreshes OAuth then sends exact body and optional login account', async () => {
    const fetcher = stubResponses(200, { requestId: 'request-123' })
    expect(await sendGoogleAdsPurchasePayload(body(), { ...config, loginCustomerId: '1112223333' })).toMatchObject({
      status: 'sent',
      response_payload: { requestId: 'request-123', processing_status: 'accepted' },
    })
    expect(fetcher.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token')
    expect(fetcher.mock.calls[0][1].body.get('grant_type')).toBe('refresh_token')
    expect(fetcher.mock.calls[1][0]).toBe('https://datamanager.googleapis.com/v1/events:ingest')
    expect(fetcher.mock.calls[1][1].headers).toEqual({
      Authorization: 'Bearer access',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      ...expectedBody,
      destinations: [
        { ...expectedBody.destinations[0], loginAccount: { accountType: 'GOOGLE_ADS', accountId: '1112223333' } },
      ],
    })
  })
  it.each([
    [401, 'not_configured'],
    [403, 'not_configured'],
    [400, 'invalid'],
    [429, 'retry'],
    [503, 'retry'],
  ])('classifies HTTP %s as %s without response secrets', async (code, status) => {
    stubResponses(Number(code), { error: { message: 'secret refresh access email@example.com' } })
    const result = await sendGoogleAdsPurchasePayload(body(), config)
    expect(result.status).toBe(status)
    expect(JSON.stringify(result)).not.toContain('email@example.com')
    expect(JSON.stringify(result)).not.toContain('secret refresh')
  })
  it.each([
    'bad json',
    {},
    { error: { code: 400 } },
  ])('does not acknowledge malformed 2xx responses', async (response) => {
    stubResponses(200, response)
    expect((await sendGoogleAdsPurchasePayload(body(), config)).status).toBe('retry')
  })
  it('marks validateOnly as validated even when the API returns no result', async () => {
    const fetcher = stubResponses(200, {})
    expect((await sendGoogleAdsPurchasePayload(body(), { ...config, validateOnly: true })).status).toBe('validated')
    expect(JSON.parse(fetcher.mock.calls[1][1].body).validateOnly).toBe(true)
  })
  it('sanitizes non-blocking field warnings', async () => {
    stubResponses(200, {
      requestId: 'request-123',
      fieldWarnings: [
        { reason: 'WARNING_REASON_GENERIC', field: 'events[0].userData', description: 'email@example.com secret' },
      ],
    })
    const result = await sendGoogleAdsPurchasePayload(body(), config)
    expect(result).toMatchObject({
      status: 'sent',
      response_payload: { fieldWarnings: [{ reason: 'WARNING_REASON_GENERIC', field: 'events[0].userData' }] },
    })
    expect(JSON.stringify(result)).not.toContain('email@example.com')
  })
  it('keeps missing credentials repairable and explicitly refuses legacy payloads before any HTTP', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect((await sendGoogleAdsPurchasePayload(body(), { ...config, refreshToken: null })).status).toBe(
      'not_configured',
    )
    expect(
      await sendGoogleAdsPurchasePayload({ customerId: config.customerId, conversions: [{}] }, config),
    ).toMatchObject({ status: 'invalid', error_code: 'google_ads_payload_remap_required' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('classifies refused refresh tokens as repairable without leaking Google messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'secret refresh' }), {
          status: 400,
        }),
      ),
    )
    const result = await sendGoogleAdsPurchasePayload(body(), config)
    expect(result.status).toBe('not_configured')
    expect(JSON.stringify(result)).not.toContain('secret refresh')
  })
  it('bounds an in-flight OAuth refresh and sanitizes thrown errors', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('secret refresh token')), { once: true })
          }),
      ),
    )
    const pending = sendGoogleAdsPurchasePayload(body(), config)
    await vi.advanceTimersByTimeAsync(15000)
    const result = await pending
    expect(result.status).toBe('retry')
    expect(JSON.stringify(result)).not.toContain('secret refresh token')
  })
  it('rejects invalid persisted payloads without HTTP', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect((await sendGoogleAdsPurchasePayload({ ...body(), events: [] }, config)).status).toBe('invalid')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('honors cancellation before making a network request', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const signal = AbortSignal.abort()
    expect((await sendGoogleAdsPurchasePayload(body(), config, signal)).status).toBe('retry')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
