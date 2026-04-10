// SPEC-039 — 12-step HTTP pipeline for H3

import { MantaError } from '@manta/core/errors'
import type { H3Event } from 'h3'
import { getMethod, getRequestHeader, readBody, setResponseHeader } from 'h3'

/**
 * Error status mapping — SPEC-041
 */
export const ERROR_STATUS_MAP: Record<string, number> = {
  NOT_FOUND: 404,
  INVALID_DATA: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  DUPLICATE_ERROR: 409,
  CONFLICT: 409,
  NOT_ALLOWED: 405,
  UNEXPECTED_STATE: 500,
  DB_ERROR: 500,
  UNKNOWN_MODULES: 500,
  INVALID_STATE: 500,
  NOT_IMPLEMENTED: 501,
  RESOURCE_EXHAUSTED: 429,
}

/**
 * MantaErrorResponse body format — SPEC-041
 */
export interface ErrorResponseBody {
  type: string
  message: string
  code?: string
  details?: unknown
  stack?: string
}

export interface PipelineContext {
  requestId: string
  method: string
  path: string
  body?: unknown
  params?: Record<string, string>
}

/**
 * Step 1 — Generate or propagate x-request-id
 */
export function extractRequestId(event: H3Event): string {
  const existing = getRequestHeader(event, 'x-request-id')
  if (existing) return existing
  return crypto.randomUUID()
}

/**
 * Step 2 — CORS headers based on namespace
 */
export function setCorsHeaders(event: H3Event, _path: string, allowedOrigins?: string[]): void {
  const origin = getRequestHeader(event, 'origin')

  if (!origin) {
    // No CORS needed for same-origin requests
    return
  }

  // If allowedOrigins configured, validate
  if (allowedOrigins && allowedOrigins.length > 0) {
    if (!allowedOrigins.includes(origin) && !allowedOrigins.includes('*')) {
      return // Don't set CORS headers for disallowed origins
    }
  }

  setResponseHeader(event, 'Access-Control-Allow-Origin', origin)
  setResponseHeader(event, 'Access-Control-Allow-Credentials', 'true')
  setResponseHeader(event, 'Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
  setResponseHeader(
    event,
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-publishable-api-key, x-request-id',
  )
  setResponseHeader(event, 'Access-Control-Max-Age', '86400')
}

/**
 * Step 1.5 — Security headers (before handler runs)
 */
export function setSecurityHeaders(event: H3Event): void {
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'X-Frame-Options', 'DENY')
  setResponseHeader(event, 'X-XSS-Protection', '0')
  setResponseHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
}

/**
 * Step 5 — Parse body based on content-type
 */
export async function parseBody(event: H3Event, maxBodySize = 1048576): Promise<unknown> {
  const method = getMethod(event)
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return undefined
  }

  const contentLength = getRequestHeader(event, 'content-length')
  if (contentLength && parseInt(contentLength, 10) > maxBodySize) {
    throw new MantaError('INVALID_DATA', `Request body too large (max ${maxBodySize} bytes)`)
  }

  try {
    return await readBody(event)
  } catch {
    return undefined
  }
}

/**
 * Step 12 — Map errors to HTTP responses
 */
export function mapErrorToResponse(error: unknown, isDev: boolean): { status: number; body: ErrorResponseBody } {
  if (MantaError.is(error)) {
    const status = ERROR_STATUS_MAP[error.type] ?? 500
    const body: ErrorResponseBody = {
      type: error.type,
      message: error.message,
    }
    if (error.code) body.code = error.code
    if (isDev && error.stack) body.stack = error.stack
    return { status, body }
  }

  // Unknown error — log in dev for debugging
  if (isDev) {
    console.error('[pipeline] Unhandled error:', error)
  }
  return {
    status: 500,
    body: {
      type: 'UNEXPECTED_STATE',
      message: isDev ? String((error as Error)?.message ?? error) : 'An internal error occurred',
    },
  }
}
