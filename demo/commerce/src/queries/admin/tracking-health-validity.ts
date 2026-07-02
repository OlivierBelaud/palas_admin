export type DestinationSummary = {
  destination: string
  supported: boolean
  ready: boolean
  blockers: string[]
}

export const CONSENT_BLOCKERS = [
  'analytics_consent_not_granted',
  'ad_storage_consent_not_granted',
  'ad_user_data_consent_not_granted',
  'ad_personalization_consent_not_granted',
]

export function trackingHealthValidationErrors(
  validation: Record<string, unknown>,
  ga4Destination: DestinationSummary,
) {
  const errors = [...validationBaseErrors(validation)]
  if (ga4Destination.supported && !ga4Destination.ready) {
    errors.push(
      ...ga4Destination.blockers.filter((blocker) => !isConsentBlocker(blocker)).map((blocker) => `ga4:${blocker}`),
    )
  }
  return Array.from(new Set(errors))
}

export function isTrackingHealthValid(validation: Record<string, unknown>, ga4Destination: DestinationSummary) {
  return trackingHealthValidationErrors(validation, ga4Destination).length === 0
}

function validationBaseErrors(validation: Record<string, unknown>): string[] {
  return Array.isArray(validation.errors)
    ? validation.errors.filter((item): item is string => typeof item === 'string')
    : []
}

function isConsentBlocker(blocker: string) {
  return CONSENT_BLOCKERS.includes(blocker)
}
