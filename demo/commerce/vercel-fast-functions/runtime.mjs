import { createHmac, timingSafeEqual } from 'node:crypto'
import postgres from 'postgres'

let client = null

class FastFunctionError extends Error {}

export function db() {
  if (client) return client
  const url = process.env.DATABASE_URL
  if (!url) throw new FastFunctionError('DATABASE_URL is not configured')
  client = postgres(url, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 2,
    prepare: false,
  })
  return client
}

export function json(data, init = {}) {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function unauthorized() {
  return json({ type: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 })
}

export function requireAdmin(req) {
  const token = extractBearerToken(req)
  const secret = process.env.JWT_SECRET
  if (!token || !secret) return null

  try {
    const payload = verifyHs256Jwt(token, secret)
    const type = payload.type ?? payload.actor_type
    return type === 'admin' ? payload : null
  } catch {
    return null
  }
}

export function clampInt(value, fallback, min, max) {
  const parsed = value == null ? fallback : Number(value)
  if (!Number.isInteger(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export function toNumber(value) {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0
  return Number.isFinite(n) ? n : 0
}

export function roundMoney(value) {
  return Math.round(value * 100) / 100
}

export function rate(part, total) {
  return total > 0 ? Math.round((part / total) * 10000) / 10000 : 0
}

export function timingHeader(timings) {
  return Object.entries(timings)
    .map(([name, value]) => `${name};dur=${Math.round(value)}`)
    .join(', ')
}

export function nowMs() {
  return performance.now()
}

function extractBearerToken(req) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice('Bearer '.length)
}

function verifyHs256Jwt(token, secret) {
  const parts = token.split('.')
  if (parts.length !== 3) throw new FastFunctionError('Invalid token format')
  const [header, body, signature] = parts
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  const actualBuffer = Buffer.from(signature, 'base64url')
  const expectedBuffer = Buffer.from(expected, 'base64url')
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new FastFunctionError('Invalid token signature')
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new FastFunctionError('Token expired')
  return payload
}
