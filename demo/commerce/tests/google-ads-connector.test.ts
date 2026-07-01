import { describe, expect, it } from 'vitest'
import { getGoogleAdsConfig, mapCanonicalToGoogleAds } from '../src/modules/event-hub/google-ads-connector'

const config = {
  customerId: '1234567890',
  purchaseConversionActionId: '987654321',
  addToCartConversionActionId: null,
  beginCheckoutConversionActionId: null,
  leadConversionActionId: null,
  addShippingInfoConversionActionId: null,
  addPaymentInfoConversionActionId: null,
}

const purchasePayload = {
  event_time: '2026-06-12T10:11:12.000Z',
  user: {
    gclid: 'gclid_123',
    email_sha256: 'a'.repeat(64),
  },
  consent: {
    ad_user_data: true,
    ad_storage: true,
    ad_personalization: true,
  },
  context: {
    url: 'https://fancypalas.com/checkouts/cn/thank-you',
  },
  ecommerce: {
    currency: 'EUR',
    value: 150,
    transaction_id: 'order_123',
  },
  checkout: {
    shopify_order_id: 'order_123',
  },
}

describe('Google Ads connector mapping', () => {
  it('rejects events outside configured Google Ads conversion steps', () => {
    const mapped = mapCanonicalToGoogleAds('view_item', purchasePayload, config)

    expect(mapped.supported).toBe(false)
    if (mapped.supported) throw new Error('Expected Google Ads mapping to be unsupported')
    expect(mapped.errors).toContain('google_ads_conversion_not_supported')
  })

  it('maps purchase payloads to UploadClickConversions shape', () => {
    const mapped = mapCanonicalToGoogleAds('purchase', purchasePayload, config)

    expect(mapped.ok).toBe(true)
    expect(mapped.payload).toMatchObject({
      customerId: '1234567890',
      conversions: [
        {
          conversionAction: 'customers/1234567890/conversionActions/987654321',
          conversionDateTime: '2026-06-12 10:11:12+00:00',
          conversionValue: 150,
          currencyCode: 'EUR',
          orderId: 'order_123',
          gclid: 'gclid_123',
          consent: {
            adUserData: 'GRANTED',
            adPersonalization: 'GRANTED',
          },
          userIdentifiers: [{ hashedEmail: 'a'.repeat(64), userIdentifierSource: 'FIRST_PARTY' }],
        },
      ],
      partialFailure: true,
    })
  })

  it('supports configured add_to_cart conversion actions', () => {
    const mapped = mapCanonicalToGoogleAds('add_to_cart', purchasePayload, {
      ...config,
      purchaseConversionActionId: null,
      addToCartConversionActionId: '111222333',
    })

    expect(mapped.ok).toBe(true)
    expect(mapped.payload).toMatchObject({
      customerId: '1234567890',
      conversions: [
        {
          conversionAction: 'customers/1234567890/conversionActions/111222333',
          conversionDateTime: '2026-06-12 10:11:12+00:00',
          conversionValue: 150,
          currencyCode: 'EUR',
          gclid: 'gclid_123',
        },
      ],
    })
    const conversions = mapped.payload.conversions as Array<Record<string, unknown>>
    expect(conversions[0]).not.toHaveProperty('orderId')
  })

  it('supports configured checkout step conversion actions', () => {
    const addShipping = mapCanonicalToGoogleAds('add_shipping_info', purchasePayload, {
      ...config,
      purchaseConversionActionId: null,
      addShippingInfoConversionActionId: '444555666',
    })
    const addPayment = mapCanonicalToGoogleAds('add_payment_info', purchasePayload, {
      ...config,
      purchaseConversionActionId: null,
      addPaymentInfoConversionActionId: '555666777',
    })

    expect(addShipping.ok).toBe(true)
    expect(addPayment.ok).toBe(true)
    expect(addShipping.payload).toMatchObject({
      conversions: [{ conversionAction: 'customers/1234567890/conversionActions/444555666' }],
    })
    expect(addPayment.payload).toMatchObject({
      conversions: [{ conversionAction: 'customers/1234567890/conversionActions/555666777' }],
    })
  })

  it('rejects Google Ads events without a configured conversion action id', () => {
    const mapped = mapCanonicalToGoogleAds('add_to_cart', purchasePayload, {
      ...config,
      purchaseConversionActionId: null,
      addToCartConversionActionId: null,
    })

    if (mapped.ok) throw new Error('Expected Google Ads mapping to be invalid')
    expect(mapped.errors).toContain('google_ads_conversion_action_id_missing')
  })

  it('accepts gbraid from the conversion URL when gclid is unavailable', () => {
    const mapped = mapCanonicalToGoogleAds(
      'purchase',
      {
        ...purchasePayload,
        user: {},
        context: { url: 'https://fancypalas.com/thank-you?gbraid=gbraid_123' },
      },
      config,
    )

    expect(mapped.ok).toBe(true)
    expect(mapped.payload).toMatchObject({
      conversions: [{ gbraid: 'gbraid_123' }],
    })
  })

  it('rejects purchases without Google click IDs or enhanced-conversion identifiers', () => {
    const mapped = mapCanonicalToGoogleAds(
      'purchase',
      {
        ...purchasePayload,
        user: {},
        context: { url: 'https://fancypalas.com/thank-you' },
      },
      config,
    )

    if (mapped.ok) throw new Error('Expected Google Ads mapping to be invalid')
    expect(mapped.errors).toContain('google_ads_identifier_missing')
  })

  it('keeps non-consented purchases out of Google Ads dispatch', () => {
    const mapped = mapCanonicalToGoogleAds(
      'purchase',
      {
        ...purchasePayload,
        consent: {
          ad_storage: false,
          ad_user_data: false,
          ad_personalization: false,
        },
      },
      config,
    )

    if (mapped.ok) throw new Error('Expected Google Ads mapping to be invalid')
    expect(mapped.errors).toContain('google_ads_ad_storage_consent_not_granted')
    expect(mapped.errors).toContain('google_ads_ad_user_data_consent_not_granted')
    expect(mapped.errors).toContain('google_ads_ad_personalization_consent_not_granted')
  })

  it('sanitizes Google Ads customer ids from env', () => {
    const loaded = getGoogleAdsConfig({
      GOOGLE_ADS_CUSTOMER_ID: '123-456-7890',
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: '111-222-3333',
      GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID: '987654321',
      GOOGLE_ADS_ADD_TO_CART_CONVERSION_ACTION_ID: '111-222-333',
      GOOGLE_ADS_BEGIN_CHECKOUT_CONVERSION_ACTION_ID: '222-333-444',
      GOOGLE_ADS_LEAD_CONVERSION_ACTION_ID: '333-444-555',
      GOOGLE_ADS_ADD_SHIPPING_INFO_CONVERSION_ACTION_ID: '444-555-666',
      GOOGLE_ADS_ADD_PAYMENT_INFO_CONVERSION_ACTION_ID: '555-666-777',
    } as NodeJS.ProcessEnv)

    expect(loaded.customerId).toBe('1234567890')
    expect(loaded.loginCustomerId).toBe('1112223333')
    expect(loaded.purchaseConversionActionId).toBe('987654321')
    expect(loaded.addToCartConversionActionId).toBe('111222333')
    expect(loaded.beginCheckoutConversionActionId).toBe('222333444')
    expect(loaded.leadConversionActionId).toBe('333444555')
    expect(loaded.addShippingInfoConversionActionId).toBe('444555666')
    expect(loaded.addPaymentInfoConversionActionId).toBe('555666777')
  })
})
