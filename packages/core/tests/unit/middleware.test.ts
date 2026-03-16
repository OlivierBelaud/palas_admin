import { describe, it, expect } from 'vitest'
import { defineMiddlewares, mapErrorToStatus, ERROR_STATUS_MAP } from '@manta/core'

describe('defineMiddlewares', () => {
  // MW-01 — Returns middleware configs as-is
  it('returns configs', () => {
    const configs = defineMiddlewares([
      {
        matcher: '/admin/products',
        method: 'POST',
        validators: { body: {} },
      },
      {
        matcher: '/store/*',
        rateLimit: { maxRequests: 200, windowMs: 60_000 },
      },
    ])

    expect(configs).toHaveLength(2)
    expect(configs[0].matcher).toBe('/admin/products')
    expect(configs[0].method).toBe('POST')
    expect(configs[1].rateLimit?.maxRequests).toBe(200)
  })

  // MW-02 — RegExp matcher
  it('supports RegExp matcher', () => {
    const configs = defineMiddlewares([
      { matcher: /\/api\/v\d+\/.*/ },
    ])

    expect(configs[0].matcher).toBeInstanceOf(RegExp)
  })

  // MW-03 — Function matcher
  it('supports function matcher', () => {
    const fn = () => true
    const configs = defineMiddlewares([
      { matcher: fn },
    ])

    expect(typeof configs[0].matcher).toBe('function')
  })

  // MW-04 — AUTHENTICATE: false
  it('supports AUTHENTICATE: false', () => {
    const configs = defineMiddlewares([
      { matcher: '/public', AUTHENTICATE: false },
    ])

    expect(configs[0].AUTHENTICATE).toBe(false)
  })
})

describe('mapErrorToStatus', () => {
  // ES-01 — Maps all MantaError types correctly
  it('maps all error types to HTTP status codes', () => {
    expect(mapErrorToStatus('NOT_FOUND')).toBe(404)
    expect(mapErrorToStatus('INVALID_DATA')).toBe(400)
    expect(mapErrorToStatus('UNAUTHORIZED')).toBe(401)
    expect(mapErrorToStatus('FORBIDDEN')).toBe(403)
    expect(mapErrorToStatus('DUPLICATE_ERROR')).toBe(422)
    expect(mapErrorToStatus('CONFLICT')).toBe(409)
    expect(mapErrorToStatus('NOT_ALLOWED')).toBe(400)
    expect(mapErrorToStatus('DB_ERROR')).toBe(500)
    expect(mapErrorToStatus('UNEXPECTED_STATE')).toBe(500)
    expect(mapErrorToStatus('INVALID_STATE')).toBe(500)
    expect(mapErrorToStatus('NOT_IMPLEMENTED')).toBe(501)
    expect(mapErrorToStatus('RESOURCE_EXHAUSTED')).toBe(429)
  })

  // ES-02 — Unknown error type defaults to 500
  it('defaults to 500 for unknown types', () => {
    expect(mapErrorToStatus('SOMETHING_WEIRD')).toBe(500)
  })

  // ES-03 — ERROR_STATUS_MAP is complete
  it('ERROR_STATUS_MAP covers all expected types', () => {
    expect(Object.keys(ERROR_STATUS_MAP).length).toBeGreaterThanOrEqual(12)
  })
})
