import { hasRawDb, type RawDb, rawDbFromPool } from '../../../utils/raw-db'

export type AdminApiRequest = Request & {
  app?: {
    infra?: {
      db?: unknown
    }
  }
  scope?: { resolve: <T = unknown>(key: string) => T | undefined }
  authContext?: { id?: string; type?: string }
  verifyAuth?: (context: string) => Promise<unknown>
}

type AdminAuthContext = {
  id?: string
  type?: string
  actor_type?: string
  auth_identity_id?: string
  app_metadata?: { email?: string }
  metadata?: { email?: string }
}

export function dbFrom(req: AdminApiRequest): RawDb {
  const direct = req.app?.infra?.db
  if (hasRawDb(direct)) return direct
  const directPool = rawDbFromPool(direct)
  if (directPool) return directPool

  const scoped = req.scope?.resolve<unknown>('IDatabasePort')
  if (hasRawDb(scoped)) return scoped
  const scopedPool = rawDbFromPool(scoped)
  if (scopedPool) return scopedPool

  throw new MantaError('UNEXPECTED_STATE', 'Database unavailable')
}

export async function requireAdmin(req: AdminApiRequest): Promise<Response | null> {
  const auth = req.authContext ?? (await verifyAdminJwt(req))
  if (!auth || !isAdminAuth(auth)) {
    return Response.json({ type: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 })
  }
  return null
}

function isAdminAuth(auth: unknown): auth is AdminAuthContext {
  return (
    !!auth &&
    typeof auth === 'object' &&
    ((auth as AdminAuthContext).type ?? (auth as AdminAuthContext).actor_type) === 'admin'
  )
}

async function verifyAdminJwt(req: Request): Promise<AdminAuthContext | null> {
  const token = extractBearerToken(req)
  const secret = process.env.JWT_SECRET
  if (!token || !secret) return null

  try {
    const payload = await verifyHs256Jwt(token, secret)
    return isAdminAuth(payload) ? payload : null
  } catch {
    return null
  }
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice('Bearer '.length)
}

async function verifyHs256Jwt(token: string, secret: string): Promise<AdminAuthContext> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new MantaError('UNAUTHORIZED', 'Invalid token format')
  const [header, body, signature] = parts
  const { createHmac, timingSafeEqual } = await import('node:crypto')
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  const actualBuffer = Buffer.from(signature, 'base64url')
  const expectedBuffer = Buffer.from(expected, 'base64url')
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new MantaError('UNAUTHORIZED', 'Invalid token signature')
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as AdminAuthContext & { exp?: number }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new MantaError('UNAUTHORIZED', 'Token expired')
  return payload
}
