import { describe, expect, it } from 'vitest'
import {
  isAdConsentErrorCode,
  isTrackingHealthValid,
  trackingHealthValidationErrors,
  type DestinationSummary,
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
