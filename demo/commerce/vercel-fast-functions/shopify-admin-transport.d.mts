export type ShopifyAdminErrorKind =
  | 'authentication'
  | 'cancelled'
  | 'configuration'
  | 'graphql'
  | 'invalid_response'
  | 'network'
  | 'not_found'
  | 'outcome_unknown'
  | 'rate_limited'
  | 'request'
  | 'timeout'
  | 'upstream'

export class ShopifyAdminTransportError extends Error {
  readonly kind: ShopifyAdminErrorKind
  readonly status?: number
  readonly retryable: boolean
}

export interface ShopifyAdminOptions {
  domain?: string
  token?: string
  apiVersion?: string
  timeoutMs?: number
  maxAttempts?: number
  retryDelayMs?: number
  allowUnsafeRetry?: boolean
  signal?: AbortSignal
  env?: Record<string, string | undefined>
}

export const SHOPIFY_ADMIN_DEFAULTS: Readonly<{
  apiVersion: string
  domain: string
  timeoutMs: number
}>

export function resolveShopifyAdminConfig(
  overrides?: ShopifyAdminOptions,
  env?: Record<string, string | undefined>,
): {
  apiVersion: string
  domain: string
  endpoint: string
  timeoutMs: number
  token: string
}

export function shopifyAdminRequest(
  pathOrUrl: string,
  init?: RequestInit,
  options?: ShopifyAdminOptions,
): Promise<Response>

export function shopifyAdminJson<T = unknown>(
  pathOrUrl: string,
  init?: RequestInit,
  options?: ShopifyAdminOptions,
): Promise<{ data: T; response: Response }>

export function shopifyAdminGraphql<T = Record<string, unknown>>(
  query: string,
  variables?: Record<string, unknown>,
  options?: ShopifyAdminOptions,
): Promise<T>
