// SPEC-039 — createMantaHandler for Nitro

import { defineEventHandler, getMethod, readBody, setResponseHeader, setResponseStatus, send } from 'h3'
import type { H3Event, EventHandler } from 'h3'
import { mapErrorToResponse, extractRequestId, setCorsHeaders } from './pipeline'

export interface MantaHandlerOptions {
  isDev?: boolean
}

/**
 * Creates an H3 event handler that runs a Manta route handler
 * through the pipeline.
 *
 * Usage in a Nitro server:
 * ```ts
 * app.use('/admin/products', createMantaHandler(async (req) => {
 *   // ... your handler
 *   return Response.json({ products })
 * }))
 * ```
 */
export function createMantaHandler(
  handler: (req: Request) => Promise<Response> | Response,
  options?: MantaHandlerOptions,
): EventHandler {
  const isDev = options?.isDev ?? true

  return defineEventHandler(async (event: H3Event) => {
    try {
      // Step 1 — RequestID
      const requestId = extractRequestId(event)
      setResponseHeader(event, 'x-request-id', requestId)

      // Step 2 — CORS
      setCorsHeaders(event, event.path ?? '/')

      // Step 5 — Body
      const method = getMethod(event)
      let body: unknown
      if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        try { body = await readBody(event) } catch { /* empty body */ }
      }

      // Build request for handler
      const url = `http://localhost${event.path ?? '/'}`
      const request = new Request(url, {
        method,
        headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      })
      Object.defineProperty(request, 'validatedBody', { value: body, enumerable: true })
      Object.defineProperty(request, 'requestId', { value: requestId, enumerable: true })

      // Step 11 — Handler
      const response = await handler(request)

      // Send response
      setResponseStatus(event, response.status)
      response.headers.forEach((value, key) => {
        setResponseHeader(event, key, value)
      })
      setResponseHeader(event, 'content-type', response.headers.get('content-type') ?? 'application/json')

      return send(event, await response.text())
    } catch (error) {
      // Step 12 — Error handler
      const { status, body: errBody } = mapErrorToResponse(error, isDev)
      setResponseStatus(event, status)
      setResponseHeader(event, 'content-type', 'application/json')
      return send(event, JSON.stringify(errBody))
    }
  })
}
