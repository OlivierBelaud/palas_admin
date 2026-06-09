export type RuntimeSql = {
  <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>
  unsafe: <T = unknown>(query: string, params?: unknown[]) => Promise<T>
  json?: (value: unknown) => unknown
}

export interface RuntimeDatabasePort {
  getPool(): unknown
  raw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

export interface RuntimeNotificationPort {
  send(notification: {
    to: string
    channel: string
    from?: string
    replyTo?: string | string[]
    subject?: string
    html?: string
    text?: string
    headers?: Record<string, string>
    tags?: Array<{ name: string; value: string }>
    idempotency_key?: string
  }): Promise<{ status: 'SUCCESS' | 'FAILURE' | 'PENDING'; id?: string; error?: Error }>
}

export type RuntimeApp = {
  infra?: {
    db?: unknown
    notification?: unknown
  }
  emit?: (eventName: string, data: unknown) => Promise<void>
  resolve?: <T = unknown>(key: string) => T
}

export function resolveDatabase(app: RuntimeApp | undefined): RuntimeDatabasePort | null {
  const db = app?.infra?.db ?? safeResolve(app, 'IDatabasePort') ?? safeResolve(app, 'db')
  if (isDatabasePort(db)) return db
  return null
}

export function resolveNotification(app: RuntimeApp | undefined): RuntimeNotificationPort | null {
  const notification = app?.infra?.notification ?? safeResolve(app, 'INotificationPort')
  if (isNotificationPort(notification)) return notification
  return null
}

export function resolveSql(app: RuntimeApp | undefined): RuntimeSql | null {
  const db = resolveDatabase(app)
  if (!db) return null
  const pool = db.getPool()
  return typeof pool === 'function' ? (pool as RuntimeSql) : null
}

export function jsonParam(sql: RuntimeSql, value: unknown): unknown {
  return typeof sql.json === 'function' ? sql.json(value) : JSON.stringify(value)
}

function safeResolve(app: RuntimeApp | undefined, key: string): unknown {
  if (!app?.resolve) return undefined
  try {
    return app.resolve(key)
  } catch {
    return undefined
  }
}

function isDatabasePort(value: unknown): value is RuntimeDatabasePort {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as RuntimeDatabasePort).getPool === 'function' &&
    typeof (value as RuntimeDatabasePort).raw === 'function'
  )
}

function isNotificationPort(value: unknown): value is RuntimeNotificationPort {
  return !!value && typeof value === 'object' && typeof (value as RuntimeNotificationPort).send === 'function'
}
