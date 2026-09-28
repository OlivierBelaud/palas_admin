export type ControlDestination = 'meta_capi' | 'google_ads' | 'pinterest' | 'ga4'
export type ControlWindow = { from: string; to: string; timezone: string }
export type EvidenceState =
  | 'available'
  | 'partial'
  | 'not_configured'
  | 'permission_denied'
  | 'rate_limited'
  | 'unavailable'
  | 'error'

export type EvidenceRow = {
  event_name: string
  label: string
  value: number | string | null
  detail?: string
}

export type EvidenceSection = {
  key: string
  title: string
  state: EvidenceState
  source: string
  fetched_at: string | null
  window: ControlWindow | null
  granularity: string
  provenance: string
  message: string
  limitations: string[]
  rows: EvidenceRow[]
}

export type ControlConfig = {
  identifiers: Array<{ label: string; value: string | null }>
  send_configured: boolean
  current_mode: string
  setup: string[]
}

export type LocalEventControl = {
  event_name: string
  provider_event_name: string | null
  captured: number
  eligible: number
  excluded: number
  unknown_eligibility: number
  missing_dispatch: number
  statuses: Record<string, number>
}

export type ControlReceipt = {
  event_id: string
  event_name: string
  status: string
  attempt_count: number
  received_at: string
  last_attempt_at: string | null
  sent_at: string | null
  http_status: number | null
  error_code: string | null
  receipt_kind: 'acknowledged' | 'validation_only' | 'http_response' | 'unknown'
  details_available: boolean
}

export type LocalControl = {
  basis: 'event_received_at'
  rows: LocalEventControl[]
  // A separate send-time series, not the current status of the reception cohort.
  sent_in_window: Array<{ event_name: string; provider_event_name: string | null; count: number }>
  recent: ControlReceipt[]
  receipt_count: number
  recent_limit: number
  detail_retention_hours: number
  limitations: string[]
}

export type TrackingControlData = {
  destination: ControlDestination
  generated_at: string
  requested_window: ControlWindow
  config: ControlConfig
  local: LocalControl
  remote: EvidenceSection[]
}

// Server-only inputs derived from retained Google acceptance receipts.
export type ProviderReadInput = {
  destination: ControlDestination
  window: ControlWindow
  google_requests: Array<{ request_id: string; event_name: string }>
  google_limit?: number
  counts_only?: boolean
  google_request_count: number
}

export type ProviderReadResult = { config: ControlConfig; sections: EvidenceSection[] }
