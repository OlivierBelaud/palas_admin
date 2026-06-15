import { signContactToken } from './manta-uid'

type ParamValue = string | number | null | undefined

export interface EmailLinkTrackingInput {
  email: string
  campaign: string
  messageType: string
  messageId?: string | null
  sequenceVersion?: number | string | null
  sequenceStep?: number | string | null
  cartId?: string | null
  cartToken?: string | null
  caseId?: string | null
}

export type EmailLinkTrackingParams = Record<string, string>

function put(params: EmailLinkTrackingParams, key: string, value: ParamValue): void {
  if (value === null || value === undefined) return
  const normalized = String(value).trim()
  if (!normalized) return
  params[key] = normalized
}

export function sequenceStepFromMessageType(messageType: string): number | null {
  const match = messageType.match(/_(\d+)$/)
  if (!match) return null
  const step = Number(match[1])
  return Number.isFinite(step) && step > 0 ? step : null
}

export function buildEmailLinkTrackingParams(input: EmailLinkTrackingInput): EmailLinkTrackingParams {
  const step = input.sequenceStep ?? sequenceStepFromMessageType(input.messageType)
  const params: EmailLinkTrackingParams = {
    u: signContactToken(input.email),
    utm_source: 'palas_crm',
    utm_medium: 'email',
    utm_campaign: input.campaign,
    utm_content: input.messageType,
  }

  put(params, 'utm_id', input.messageId)
  put(params, 'palas_email_type', input.campaign)
  put(params, 'palas_email_message_type', input.messageType)
  put(params, 'palas_email_message_id', input.messageId)
  put(params, 'palas_email_sequence_version', input.sequenceVersion)
  put(params, 'palas_email_sequence_step', step)
  put(params, 'palas_cart_id', input.cartId)
  put(params, 'palas_cart_token', input.cartToken)
  put(params, 'palas_case_id', input.caseId)

  return params
}
