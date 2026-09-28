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

export const AD_CONSENT_ERROR_CODES = [
  'meta_capi_ad_storage_consent_not_granted',
  'meta_capi_ad_user_data_consent_not_granted',
  'meta_capi_ad_personalization_consent_not_granted',
  'google_ads_ad_storage_consent_not_granted',
  'google_ads_ad_user_data_consent_not_granted',
  'google_ads_ad_personalization_consent_not_granted',
  'pinterest_ad_storage_consent_not_granted',
  'pinterest_ad_user_data_consent_not_granted',
  'pinterest_ad_personalization_consent_not_granted',
]

export const DELIVERY_CONSENT_ERROR_CODES = ['ga4_analytics_consent_not_granted', ...AD_CONSENT_ERROR_CODES]

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

export function isConsentBlocker(blocker: string) {
  return CONSENT_BLOCKERS.includes(blocker)
}

export function isAdConsentErrorCode(value: unknown): value is string {
  return typeof value === 'string' && AD_CONSENT_ERROR_CODES.includes(value)
}

type DeliveryDestination = 'ga4' | 'meta' | 'google_ads' | 'pinterest'
type DeliveryEvent = Partial<
  Record<`${DeliveryDestination}_status` | `${DeliveryDestination}_error_code`, string | null>
> &
  Partial<Record<`${DeliveryDestination}_http_status` | `${DeliveryDestination}_attempt_count`, number | null>> & {
    ad_destinations?: DestinationSummary[]
    ga4_blockers?: string[]
    meta_blockers?: string[]
    google_ads_blockers?: string[]
    pinterest_blockers?: string[]
  }

export function formatDeliveryStatus(destination: DeliveryDestination, event: DeliveryEvent) {
  const status = normalizedDeliveryStatus(destination, event)
  const httpStatus = event[`${destination}_http_status`]
  const attemptCount = event[`${destination}_attempt_count`] ?? 0
  const label =
    status === 'sent' && (destination === 'google_ads' || destination === 'pinterest')
      ? 'Accepté API'
      : deliveryStatusLabel(status)
  if (httpStatus) return `${label} ${httpStatus}`
  if (attemptCount > 0) return `${label} x${attemptCount}`
  return label
}

export function normalizedDeliveryStatus(destination: DeliveryDestination, event: DeliveryEvent) {
  const value = event[`${destination}_status`]
  const status = typeof value === 'string' ? value.trim() : null
  if (status === 'invalid') {
    const blockers = [event[`${destination}_error_code`], ...(event[`${destination}_blockers`] ?? [])].filter(
      (value): value is string => typeof value === 'string',
    )
    if (blockers.some(isDeliveryConsentBlocker) && blockers.every(isDeliveryEligibilityBlocker))
      return 'consent_blocked'
    if (
      destination === 'google_ads' &&
      blockers.length > 0 &&
      blockers.every((code) => code === 'google_ads_identifier_missing')
    )
      return 'identifier_missing'
  }
  if (status) return status
  if (destination === 'ga4') return 'unknown'
  const canonicalDestination = destination === 'meta' ? 'meta_capi' : destination
  const legacy = Array.isArray(event.ad_destinations)
    ? event.ad_destinations.find((row) => row?.destination === canonicalDestination)
    : undefined
  if (!legacy) return 'unsupported'
  const blockers = Array.isArray(legacy.blockers) ? legacy.blockers.filter((item) => typeof item === 'string') : []
  if (blockers.some((blocker) => isConsentBlocker(blocker) || isAdConsentErrorCode(blocker))) return 'consent_blocked'
  return legacy.ready ? 'pending' : 'invalid'
}

function deliveryStatusLabel(status: string) {
  if (status === 'not_applicable' || status === 'unsupported') return 'Non applicable'
  if (status === 'identifier_missing') return 'Identifiant Google absent'
  if (status === 'consent_blocked') return 'Consentement'
  if (status === 'pending') return 'À envoyer'
  if (status === 'sent') return 'Envoyé'
  if (status === 'validated') return 'Test validé'
  if (status === 'invalid') return 'Invalide'
  if (status === 'error') return 'Erreur'
  if (status === 'retry') return 'Retry'
  if (status === 'not_configured') return 'Config'
  if (status === 'unknown') return 'N/A'
  return status
}

function isDeliveryConsentBlocker(code: string) {
  return isConsentBlocker(code) || DELIVERY_CONSENT_ERROR_CODES.includes(code)
}
function isDeliveryEligibilityBlocker(code: string) {
  return isDeliveryConsentBlocker(code) || code === 'google_ads_identifier_missing'
}
export function deliveryErrorCode(destination: DeliveryDestination, event: DeliveryEvent) {
  return (
    event[`${destination}_blockers`]?.find((code) => !isDeliveryEligibilityBlocker(code)) ??
    event[`${destination}_error_code`]
  )
}
