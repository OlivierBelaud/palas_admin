// Keep only documented enum values and known schema paths. Google descriptions,
// messages and metadata may echo submitted identifiers; never persist them.
// https://developers.google.com/data-manager/api/reference/rest/v1/ErrorReason
const REASONS = new Set(
  `ERROR_REASON_UNSPECIFIED INTERNAL_ERROR DEADLINE_EXCEEDED
RESOURCE_EXHAUSTED NOT_FOUND PERMISSION_DENIED INVALID_ARGUMENT REQUIRED_FIELD_MISSING
INVALID_FORMAT INVALID_HEX_ENCODING INVALID_BASE64_ENCODING INVALID_SHA256_FORMAT
INVALID_POSTAL_CODE INVALID_ENUM_VALUE TOO_MANY_USER_IDENTIFIERS TOO_MANY_DESTINATIONS
INVALID_DESTINATION TERMS_AND_CONDITIONS_NOT_SIGNED INVALID_NUMBER_FORMAT
INVALID_CONVERSION_ACTION_ID INVALID_CONVERSION_ACTION_TYPE INVALID_CURRENCY_CODE
INVALID_EVENT TOO_MANY_EVENTS DESTINATION_ACCOUNT_NOT_ENABLED_ENHANCED_CONVERSIONS_FOR_LEADS
DESTINATION_ACCOUNT_DATA_POLICY_PROHIBITS_ENHANCED_CONVERSIONS
DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED DUPLICATE_DESTINATION_REFERENCE
NO_IDENTIFIERS_PROVIDED OPERATING_ACCOUNT_LOGIN_ACCOUNT_MISMATCH EVENT_TIME_INVALID
NOT_ALLOWLISTED FIELD_VALUE_TOO_LONG FIELD_VALUE_TOO_SHORT TOO_MANY_ELEMENTS TOO_FEW_ELEMENTS
INVALID_RESOURCE_NAME INVALID_CLIENT_ACCOUNT_ID MISMATCHED_ACCOUNT_TYPE INVALID_MERCHANT_ID
THIRD_PARTY_USER_DATA_NOT_ALLOWED EVENT_SOURCE_AND_DESTINATION_MISMATCH DESTINATION_ACCOUNT_TYPE_MISMATCH
CONVERSION_ACTION_TOO_RECENTLY_CREATED INVALID_AD_IDENTIFIER_FOR_ACCOUNT`.split(/\s+/),
)

const STATUSES = new Set(
  `INVALID_ARGUMENT FAILED_PRECONDITION OUT_OF_RANGE UNAUTHENTICATED
PERMISSION_DENIED NOT_FOUND ALREADY_EXISTS RESOURCE_EXHAUSTED CANCELLED DATA_LOSS
UNKNOWN INTERNAL UNAVAILABLE DEADLINE_EXCEEDED UNIMPLEMENTED ABORTED`.split(/\s+/),
)

const FIELDS = new Set(
  `events destinations consent encoding validateOnly validate_only
operatingAccount operating_account loginAccount login_account linkedAccount linked_account
accountType account_type accountId account_id productDestinationId product_destination_id
reference destinationReferences destination_references eventTimestamp event_timestamp
transactionId transaction_id conversionValue conversion_value currency eventSource event_source
adIdentifiers ad_identifiers gclid gbraid wbraid userData user_data userIdentifiers user_identifiers
emailAddress email_address phoneNumber phone_number adUserData ad_user_data
adPersonalization ad_personalization`.split(/\s+/),
)

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function known(value: unknown, allowed: Set<string>): string | null {
  return typeof value === 'string' && allowed.has(value) ? value : null
}

function fieldPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 256) return null
  const parts = value.split('.')
  if (
    !['events', 'destinations', 'consent', 'encoding', 'validateOnly', 'validate_only'].includes(
      parts[0]?.replace(/\[\d+\]$/, '') ?? '',
    )
  )
    return null
  return parts.every((part) => {
    const match = part.match(/^([a-zA-Z_]+)(?:\[\d{1,5}\])?$/)
    return match && FIELDS.has(match[1])
  })
    ? value
    : null
}

export function googleAdsErrorDetails(value: unknown) {
  const error = obj(obj(value).error)
  const details = Array.isArray(error.details) ? error.details.slice(0, 20).map(obj) : []
  const fieldViolations = details
    .filter((detail) => detail['@type'] === 'type.googleapis.com/google.rpc.BadRequest')
    .flatMap((detail) => (Array.isArray(detail.fieldViolations) ? detail.fieldViolations.slice(0, 20) : []))
    .map((value) => {
      const violation = obj(value)
      const reason = known(violation.reason, REASONS)
      const field = fieldPath(violation.field)
      return reason ? { reason, ...(field ? { field } : {}) } : null
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .slice(0, 20)
  const reasons = [
    ...new Set([
      ...fieldViolations.map((violation) => violation.reason),
      ...details
        .filter((detail) => detail['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo')
        .map((detail) => known(detail.reason, REASONS))
        .filter((value): value is string => value !== null),
    ]),
  ]
  return { status: known(error.status, STATUSES), reasons, fieldViolations }
}
