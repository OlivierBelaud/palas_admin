import { type RuntimeApp, resolveDatabase } from './manta-runtime'

export type RawDb = {
  raw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

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
