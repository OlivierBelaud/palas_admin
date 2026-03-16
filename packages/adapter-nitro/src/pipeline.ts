// SPEC-039 — 12-step HTTP pipeline for H3

import type { H3Event } from 'h3'
import { readBody, getRequestHeader, setResponseHeader, getMethod, getRequestURL } from 'h3'
import { MantaError } from '@manta/core/errors'

/**
 * Error status mapping — SPEC-041
 */
export const ERROR_STATUS_MAP: Record<string, number> = {
  NOT_FOUND: 404,
  INVALID_DATA: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  DUPLICATE_ERROR: 422,
  CONFLICT: 409,
  NOT_ALLOWED: 400,
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
export function setCorsHeaders(event: H3Event, path: string): void {
  const origin = getRequestHeader(event, 'origin') ?? '*'

  setResponseHeader(event, 'Access-Control-Allow-Origin', origin)
  setResponseHeader(event, 'Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
  setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization, x-request-id, x-publishable-api-key')
  setResponseHeader(event, 'Access-Control-Allow-Credentials', 'true')

  if (path.startsWith('/store')) {
    setResponseHeader(event, 'Access-Control-Max-Age', '86400')
  }
}

/**
 * Step 5 — Parse body based on content-type
 */
export async function parseBody(event: H3Event): Promise<unknown> {
  const method = getMethod(event)
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return undefined
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
    if (isDev && error.stack) (body as Record<string, unknown>).stack = error.stack
    return { status, body }
  }

  // Unknown error — no internals leaked
  return {
    status: 500,
    body: {
      type: 'UNEXPECTED_STATE',
      message: 'An internal error occurred',
    },
  }
}
