import { randomUUID } from 'node:crypto'
import { stableMuidForEmail, verifyContactToken } from '../../../../utils/manta-uid'

const COOKIE_NAME = 'muid'
const COOKIE_MAX_AGE = 390 * 24 * 60 * 60

function isOriginAllowed(origin: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (p === origin) return true
    const m = p.match(/^(https?:\/\/)\*\.(.+)$/)
    if (!m) continue
    const [, scheme, rootHost] = m
    if (origin === `${scheme}${rootHost}`) return true
    if (origin.startsWith(scheme) && origin.slice(scheme.length).endsWith(`.${rootHost}`)) return true
  }
  return false
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = (
    process.env.ALLOWED_CORS_ORIGIN ?? 'https://fancypalas.com,https://www.fancypalas.com,https://*.fancypalas.com'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'private, no-store',
  }
  if (origin && isOriginAllowed(origin, allowed)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

function parseCookie(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}

function deriveMuidFromToken(token: string): string | null {
  try {
    const verified = verifyContactToken(token)
    if (!verified) return null
    return stableMuidForEmail(verified.email)
  } catch {
    return null
  }
}

function newMuid(): string {
  return `muid_${randomUUID().replace(/-/g, '')}`
}

function validClientMuid(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return /^muid_[a-f0-9]{32}$/i.test(trimmed) ? trimmed.toLowerCase() : null
}

function cookieDomain(req: Request): string | null {
  const host = new URL(req.url).hostname
  return host === 'fancypalas.com' || host.endsWith('.fancypalas.com') ? '.fancypalas.com' : null
}

function cookieHeader(req: Request, muid: string): string {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(muid)}`,
    'Path=/',
    `Max-Age=${COOKIE_MAX_AGE}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  const domain = cookieDomain(req)
  if (domain) attrs.push(`Domain=${domain}`)
  if (new URL(req.url).protocol === 'https:' || process.env.NODE_ENV === 'production') attrs.push('Secure')
  return attrs.join('; ')
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function GET(req: Request) {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = {
    ...corsHeaders(origin),
    'Content-Type': 'application/json',
  }

  if (!headers['Access-Control-Allow-Origin']) {
    return Response.json({ ok: false, error: 'FORBIDDEN' }, { status: 403, headers })
  }

  const url = new URL(req.url)
  const tokenMuid = deriveMuidFromToken((url.searchParams.get('u') ?? '').trim())
  const existing = parseCookie(req.headers.get('cookie'))[COOKIE_NAME]
  const clientMuid = validClientMuid(url.searchParams.get('m'))
  const muid = tokenMuid || validClientMuid(existing) || clientMuid || newMuid()
  headers['Set-Cookie'] = cookieHeader(req, muid)

  return Response.json({ ok: true, muid }, { headers })
}
