import { describe, expect, it } from 'vitest'
import {
  type DestinationSummary,
  deliveryErrorCode,
  formatDeliveryStatus,
  isAdConsentErrorCode,
  isTrackingHealthValid,
  normalizedDeliveryStatus,
  trackingHealthValidationErrors,
} from '../src/queries/admin/tracking-health-validity'

const readyGa4: DestinationSummary = {
  destination: 'ga4',
  supported: true,
  ready: true,
  blockers: [],
}

describe('tracking health validity', () => {
  it('does not mark a healthy cart event invalid only because Google Ads has no match identifier', () => {
    const validation = {
      errors: [],
      destinations: {
        ga4: readyGa4,
        google_ads: {
          destination: 'google_ads',
          supported: true,
          ready: false,
          blockers: ['google_ads_identifier_missing'],
        },
      },
    }

    expect(isTrackingHealthValid(validation, readyGa4)).toBe(true)
    expect(trackingHealthValidationErrors(validation, readyGa4)).toEqual([])
  })

  it('still reports GA4 blockers as global tracking-health errors', () => {
    const ga4MissingClientId: DestinationSummary = {
      destination: 'ga4',
      supported: true,
      ready: false,
      blockers: ['ga4_client_id_missing'],
    }

    expect(isTrackingHealthValid({ errors: [] }, ga4MissingClientId)).toBe(false)
    expect(trackingHealthValidationErrors({ errors: [] }, ga4MissingClientId)).toEqual(['ga4:ga4_client_id_missing'])
  })

  it('classifies ads consent errors as not-applicable delivery blockers', () => {
    expect(isAdConsentErrorCode('meta_capi_ad_storage_consent_not_granted')).toBe(true)
    expect(isAdConsentErrorCode('google_ads_ad_user_data_consent_not_granted')).toBe(true)
    expect(isAdConsentErrorCode('meta_capi_client_user_agent_missing')).toBe(false)
  })
})

describe('tracking health delivery labels', () => {
  it.each([
    'google_ads',
    'pinterest',
  ] as const)('labels %s validation separately from API acceptance', (destination) => {
    expect(
      formatDeliveryStatus(destination, {
        [`${destination}_status`]: 'validated',
        [`${destination}_http_status`]: 200,
        [`${destination}_attempt_count`]: 1,
      }),
    ).toBe('Test validé 200')
    expect(
      formatDeliveryStatus(destination, {
        [`${destination}_status`]: 'sent',
        [`${destination}_http_status`]: 200,
      }),
    ).toBe('Accepté API 200')
  })

  it.each(['ad_storage', 'ad_user_data', 'ad_personalization'])('classifies Pinterest %s denial', (consent) => {
    const code = `pinterest_${consent}_consent_not_granted`
    expect(isAdConsentErrorCode(code)).toBe(true)
    expect(normalizedDeliveryStatus('pinterest', { pinterest_status: 'invalid', pinterest_error_code: code })).toBe(
      'consent_blocked',
    )
    expect(formatDeliveryStatus('pinterest', { pinterest_status: 'invalid', pinterest_error_code: code })).toBe(
      'Consentement',
    )
  })

  it('supports older payloads without Pinterest fields and legacy destination summaries', () => {
    expect(formatDeliveryStatus('pinterest', {})).toBe('Non applicable')
    expect(
      formatDeliveryStatus('pinterest', {
        ad_destinations: [
          { destination: 'pinterest', supported: true, ready: false, blockers: ['ad_storage_consent_not_granted'] },
        ],
      }),
    ).toBe('Consentement')
    expect(formatDeliveryStatus('ga4', { ga4_status: 'sent' })).toBe('Envoyé')
    expect(formatDeliveryStatus('meta', { meta_status: 'sent' })).toBe('Envoyé')
  })
})

describe('tracking health eligibility regression', () => {
  it('shows GA4 consent refusal without marking it invalid', () => {
    expect(
      formatDeliveryStatus('ga4', { ga4_status: 'invalid', ga4_error_code: 'ga4_analytics_consent_not_granted' }),
    ).toBe('Consentement')
  })
  it('prioritizes consent over a missing Google identifier', () => {
    expect(
      formatDeliveryStatus('google_ads', {
        google_ads_status: 'invalid',
        google_ads_error_code: 'google_ads_identifier_missing',
        google_ads_blockers: ['google_ads_identifier_missing', 'ad_storage_consent_not_granted'],
      }),
    ).toBe('Consentement')
  })
  it('keeps missing Google identity visible as an eligibility limit', () => {
    expect(
      formatDeliveryStatus('google_ads', {
        google_ads_status: 'invalid',
        google_ads_error_code: 'google_ads_identifier_missing',
        google_ads_blockers: ['google_ads_identifier_missing'],
      }),
    ).toBe('Identifiant Google absent')
  })
  it('does not hide other payload faults behind a missing Google identity', () => {
    expect(
      normalizedDeliveryStatus('google_ads', {
        google_ads_status: 'invalid',
        google_ads_error_code: 'google_ads_identifier_missing',
        google_ads_blockers: ['google_ads_identifier_missing', 'currency_missing'],
      }),
    ).toBe('invalid')
  })
  it('preserves actual receipts even when old validation metadata was blocked', () => {
    expect(
      formatDeliveryStatus('google_ads', {
        google_ads_status: 'sent',
        google_ads_http_status: 200,
        google_ads_blockers: ['ad_storage_consent_not_granted'],
      }),
    ).toBe('Accepté API 200')
  })
})

it('keeps malformed GA4 payloads actionable even when consent also blocks sending', () => {
  expect(
    normalizedDeliveryStatus('ga4', {
      ga4_status: 'invalid',
      ga4_error_code: 'ga4_analytics_consent_not_granted',
      ga4_blockers: ['ga4_analytics_consent_not_granted', 'ga4_currency_missing'],
    }),
  ).toBe('invalid')
})

it('shows the actionable payload fault rather than the first consent code', () => {
  expect(
    deliveryErrorCode('ga4', {
      ga4_status: 'invalid',
      ga4_error_code: 'ga4_analytics_consent_not_granted',
      ga4_blockers: ['ga4_analytics_consent_not_granted', 'ga4_currency_missing'],
    }),
  ).toBe('ga4_currency_missing')
})
