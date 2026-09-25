#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const HELP = `Google Ads Data Manager — read-only request diagnostics

Usage:
  node --env-file=/private/.env.google-ads demo/commerce/scripts/google-ads-diagnostics.mjs --request-id REQUEST_ID

Uses GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET and GOOGLE_ADS_REFRESH_TOKEN.
The existing grant must include https://www.googleapis.com/auth/datamanager.
Only OAuth refresh and GET requestStatus:retrieve are performed; no events are sent.
Output contains processing statuses, record counts and known reason enums only.
SUCCESS means processing succeeded; it does not confirm final Ads attribution.
recordCount counts all submitted events, including failed events. PROCESSING means
check again later. --help does not require credentials or contact Google.
`

const STATUSES = new Set(['REQUEST_STATUS_UNKNOWN', 'SUCCESS', 'PROCESSING', 'FAILED', 'PARTIAL_SUCCESS'])
// Explicit allowlists prevent echoed identifiers or arbitrary provider text reaching stdout.
// https://developers.google.com/data-manager/api/reference/rest/v1/requestStatus/retrieve
const ERROR_REASONS = new Set(
  `UNSPECIFIED INVALID_CUSTOM_VARIABLE CUSTOM_VARIABLE_NOT_ENABLED EVENT_TOO_OLD
DENIED_CONSENT NO_CONSENT UNKNOWN_CONSENT DUPLICATE_GCLID DUPLICATE_TRANSACTION_ID INVALID_GBRAID INVALID_GCLID
INVALID_MERCHANT_ID INVALID_WBRAID INTERNAL_ERROR DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED
INVALID_EVENT INSUFFICIENT_MATCHED_TRANSACTIONS INSUFFICIENT_TRANSACTIONS INVALID_FORMAT DECRYPTION_ERROR
DEK_DECRYPTION_ERROR INVALID_WIP INVALID_KEK WIP_AUTH_FAILED KEK_PERMISSION_DENIED AWS_AUTH_FAILED
USER_IDENTIFIER_DECRYPTION_ERROR ONE_PER_CLICK_CONVERSION_ACTION_NOT_PERMITTED_WITH_BRAID MATCH_ID_NOT_FOUND
USER_ID_NOT_FOUND_FOR_MATCH_ID USER_ID_NOT_FOUND_FOR_GCLID USER_ID_NOT_FOUND_FOR_DCLID INVALID_AD_IDENTIFIERS
INVALID_MOBILE_ID_FORMAT ORIGINAL_CONVERSIONS_NOT_FOUND EVENT_ID_DECODE_ERROR USER_ID_NOT_FOUND_FOR_IMPRESSION_ID
USER_ID_NOT_FOUND CONVERSION_PRECEDES_CLICK TOO_RECENT_CLICK INVALID_CLICK INVALID_OPERATING_ACCOUNT_FOR_CLICK
CLICK_NOT_FOUND EXTERNAL_ATTRIBUTION_DATA_MISSING`
    .split(/\s+/)
    .map((suffix) => `PROCESSING_ERROR_REASON_${suffix}`),
)
ERROR_REASONS.add('PROCESSING_ERROR_OPERATING_ACCOUNT_MISMATCH_FOR_AD_IDENTIFIER')
const WARNING_REASONS = new Set(
  `UNSPECIFIED KEK_PERMISSION_DENIED DEK_DECRYPTION_ERROR DECRYPTION_ERROR
WIP_AUTH_FAILED INVALID_WIP INVALID_KEK USER_IDENTIFIER_DECRYPTION_ERROR INTERNAL_ERROR AWS_AUTH_FAILED`
    .split(/\s+/)
    .map((suffix) => `PROCESSING_WARNING_REASON_${suffix}`),
)

class DiagnosticError extends Error {}

function count(value) {
  // The REST API encodes int64 counts as decimal strings; keep their precision.
  return typeof value === 'string' && /^\d{1,19}$/.test(value) ? value : null
}

function reasonCounts(value, allowed, fallback) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).map((entry) => ({
    reason: allowed.has(entry?.reason) ? entry.reason : fallback,
    ...(count(entry?.recordCount) !== null ? { recordCount: count(entry.recordCount) } : {}),
  }))
}

function sanitizeResponse(value) {
  const destinations = value?.requestStatusPerDestination
  if (
    !Array.isArray(destinations) ||
    !destinations.length ||
    destinations.length > 100 ||
    destinations.some((destination) => !STATUSES.has(destination?.requestStatus))
  ) {
    throw new DiagnosticError('Google diagnostics returned an invalid response')
  }
  return {
    requestStatusPerDestination: destinations.map((destination) => {
      const recordCount = count(destination.eventsIngestionStatus?.recordCount)
      return {
        requestStatus: destination.requestStatus,
        ...(recordCount !== null ? { eventsIngestionStatus: { recordCount } } : {}),
        errorCounts: reasonCounts(
          destination.errorInfo?.errorCounts,
          ERROR_REASONS,
          'PROCESSING_ERROR_REASON_UNSPECIFIED',
        ),
        warningCounts: reasonCounts(
          destination.warningInfo?.warningCounts,
          WARNING_REASONS,
          'PROCESSING_WARNING_REASON_UNSPECIFIED',
        ),
      }
    }),
  }
}

export async function retrieveGoogleAdsDiagnostics(requestId, env = process.env, signal) {
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 512 || /\s/.test(requestId)) {
    throw new DiagnosticError('A valid request id is required')
  }
  const credentials = [env.GOOGLE_ADS_CLIENT_ID, env.GOOGLE_ADS_CLIENT_SECRET, env.GOOGLE_ADS_REFRESH_TOKEN]
  if (credentials.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new DiagnosticError('Google OAuth credentials are required in the environment')
  }
  const controller = new AbortController()
  const cancel = () => controller.abort()
  const timer = setTimeout(cancel, 15000)
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  try {
    controller.signal.throwIfAborted()
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: credentials[0],
        client_secret: credentials[1],
        refresh_token: credentials[2],
        grant_type: 'refresh_token',
      }),
      signal: controller.signal,
      redirect: 'error',
    })
    if (!tokenResponse.ok)
      throw new DiagnosticError(
        `Google OAuth returned HTTP ${tokenResponse.status}; check credentials and reauthorize with datamanager scope`,
      )
    const token = await tokenResponse.json()
    if (typeof token?.access_token !== 'string' || !token.access_token || token.access_token.length > 4096) {
      throw new DiagnosticError('Google OAuth returned an invalid response')
    }
    const endpoint = new URL('https://datamanager.googleapis.com/v1/requestStatus:retrieve')
    endpoint.searchParams.set('requestId', requestId)
    const response = await fetch(endpoint.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: controller.signal,
      redirect: 'error',
    })
    if (!response.ok) throw new DiagnosticError(`Google diagnostics returned HTTP ${response.status}`)
    let parsed
    try {
      parsed = await response.json()
    } catch {
      throw new DiagnosticError('Google diagnostics returned an invalid response')
    }
    return sanitizeResponse(parsed)
  } catch (error) {
    if (error instanceof DiagnosticError) throw error
    throw new DiagnosticError('Google diagnostic request failed, timed out or was cancelled')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(HELP)
    return
  }
  if (args.length !== 2 || args[0] !== '--request-id')
    throw new DiagnosticError('Use --request-id REQUEST_ID or --help')
  console.log(JSON.stringify(await retrieveGoogleAdsDiagnostics(args[1]), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof DiagnosticError ? error.message : 'Google diagnostics failed')
    process.exitCode = 1
  })
}
