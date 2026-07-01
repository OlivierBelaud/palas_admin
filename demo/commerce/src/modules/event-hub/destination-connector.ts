export type DispatchDestination = 'ga4' | 'google_ads' | 'meta_capi'

export type DispatchStatus = 'sent' | 'invalid' | 'error' | 'retry' | 'not_configured'

export type DispatchSendResult = {
  status: DispatchStatus
  http_status: number | null
  error_code: string | null
  error_message: string | null
  response_payload: Record<string, unknown> | null
}

export type DestinationConnector = {
  destination: DispatchDestination
  pendingStatuses: Array<'pending' | 'retry' | 'not_configured'>
  eventNameFilter?: string
  notConfiguredErrorCode: string
  notConfiguredMessage: string
  isConfigured(): boolean
  send(payload: Record<string, unknown>, signal?: AbortSignal): Promise<DispatchSendResult>
}
