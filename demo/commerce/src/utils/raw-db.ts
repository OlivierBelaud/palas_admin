import { type RuntimeApp, resolveDatabase } from './manta-runtime'

export type RawDb = {
  raw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

type UnsafePool = {
  unsafe(sql: string, params?: unknown[]): Promise<unknown>
}

type DatabasePortWithPool = {
  getPool(): unknown
}

const poolWrappers = new WeakMap<object, RawDb>()

type QueryContext = {
  db?: unknown
  app?: RuntimeApp
  scope?: { resolve<T = unknown>(key: string): T | undefined }
}

export function resolveRawDb(ctx: unknown): RawDb {
  const context = ctx as QueryContext | null
  if (hasRawDb(context?.db)) return context.db

  const appDb = resolveDatabase(context?.app)
  if (appDb) return appDb

  const scoped = context?.scope?.resolve<unknown>('IDatabasePort')
  if (hasRawDb(scoped)) return scoped

  throw new MantaError('UNEXPECTED_STATE', 'Raw database port unavailable')
}

export function hasRawDb(value: unknown): value is RawDb {
  return !!value && typeof value === 'object' && typeof (value as { raw?: unknown }).raw === 'function'
}

export function rawDbFromPool(value: unknown): RawDb | null {
  if (!value || typeof value !== 'object' || typeof (value as DatabasePortWithPool).getPool !== 'function') {
    return null
  }

  const cached = poolWrappers.get(value)
  if (cached) return cached

  const pool = (value as DatabasePortWithPool).getPool()
  if (!pool || typeof pool !== 'object' || typeof (pool as UnsafePool).unsafe !== 'function') return null

  const rawDb: RawDb = {
    raw: async <T = Record<string, unknown>>(query: string, params: unknown[] = []) => {
      const rows = await (pool as UnsafePool).unsafe(query, params)
      return rows as T[]
    },
  }
  poolWrappers.set(value, rawDb)
  return rawDb
}
