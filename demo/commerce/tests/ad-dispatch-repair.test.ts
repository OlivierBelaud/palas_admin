import { afterEach, describe, expect, it, vi } from 'vitest'
import { remapGoogleAdsDispatches, requeueValidatedAdDispatches } from '../src/modules/event-hub/ad-dispatch-repair'
import { googleAdsDestinationConnector } from '../src/modules/event-hub/google-ads-connector'

const payload = {
  event_id: 'evt-1',
  event_time: '2026-09-25T06:00:00Z',
  user: { gclid: 'click-1' },
  consent: { ad_storage: true, ad_user_data: true, ad_personalization: true },
  ecommerce: { transaction_id: 'order-1', value: 40, currency: 'EUR' },
  context: { url: 'https://fancypalas.com/thanks' },
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
describe('advertising dispatch repair', () => {
  it('does nothing without configuration', async () => {
    vi.spyOn(googleAdsDestinationConnector, 'isConfigured').mockReturnValue(false)
    const raw = vi.fn()
    expect(await remapGoogleAdsDispatches({ raw })).toEqual({ scanned: 0, remapped: 0 })
    expect(raw).not.toHaveBeenCalled()
  })
  it('remaps an unsent legacy receipt with a claim fence and stable order identity', async () => {
    vi.spyOn(googleAdsDestinationConnector, 'isConfigured').mockReturnValue(true)
    vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '1234567890')
    vi.stubEnv('GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID', '123')
    const raw = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 'row-1', event_name: 'purchase', payload_normalized: payload, status: 'pending', attempt_count: 2 },
      ])
      .mockResolvedValueOnce([{ id: 'row-1' }])
    expect(await remapGoogleAdsDispatches({ raw })).toEqual({ scanned: 1, remapped: 1 })
    expect(raw.mock.calls[0][0]).toContain("'pending', 'retry', 'not_configured', 'invalid', 'error'")
    expect(raw.mock.calls[1][0]).toContain('attempt_count = $8')
    expect(JSON.parse(raw.mock.calls[1][1][4])).toMatchObject({ events: [{ transactionId: 'order-1' }] })
  })
  it('requeues only explicitly named validated receipts and never sent receipts', async () => {
    const raw = vi.fn().mockResolvedValue([{ event_id: 'evt-1' }])
    expect(await requeueValidatedAdDispatches({ raw }, 'pinterest', ['evt-1'])).toEqual({ requeued: 1 })
    expect(raw.mock.calls[0][0]).toContain("status = 'validated'")
    expect(raw.mock.calls[0][1]).toEqual(['pinterest', ['evt-1']])
    expect(raw.mock.calls[0][0]).toContain('request_payload IS NOT NULL')
  })
})
