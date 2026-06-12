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

export function dbFrom(req: AdminApiRequest): RawDb {
  const direct = req.app?.infra?.db
  const directPool = rawDbFromPool(direct)
  if (directPool) return directPool
  if (hasRawDb(direct)) return direct

  const scoped = req.scope?.resolve<unknown>('IDatabasePort')
  const scopedPool = rawDbFromPool(scoped)
  if (scopedPool) return scopedPool
  if (hasRawDb(scoped)) return scoped

  throw new MantaError('UNEXPECTED_STATE', 'Database unavailable')
}

export async function requireAdmin(req: AdminApiRequest): Promise<Response | null> {
  const auth = req.authContext ?? (await req.verifyAuth?.('admin').catch(() => null))
  if (!auth || (typeof auth === 'object' && 'type' in auth && auth.type !== 'admin')) {
    return Response.json({ type: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 })
  }
  return null
}
