import { clampInt, db, iso, json, nowMs, requireAdmin, timingHeader, unauthorized } from './runtime.mjs'

const ENTITIES = {
  cart: {
    table: 'carts',
    search: ['email', 'first_name', 'last_name', 'cart_token', 'checkout_token', 'shopify_order_id'],
    defaultSort: { field: 'updated_at', order: 'desc' },
  },
  order: {
    table: 'orders',
    search: ['email', 'order_number', 'shopify_order_id', 'sales_channel'],
    defaultSort: { field: 'placed_at', order: 'desc' },
  },
  contact: {
    table: 'contacts',
    search: ['email', 'first_name', 'last_name', 'phone', 'shopify_customer_id', 'distinct_id'],
    defaultSort: { field: 'last_activity_at', order: 'desc' },
  },
  customer: {
    table: 'customers',
    search: ['email', 'first_name', 'last_name'],
    defaultSort: { field: 'created_at', order: 'desc' },
  },
  customerGroup: {
    table: 'customer_groups',
    search: ['name'],
    defaultSort: { field: 'created_at', order: 'desc' },
  },
  visitorSession: {
    table: 'visitor_sessions',
    search: ['distinct_id', 'session_id', 'email_at_session_start', 'email_at_session_end', 'contact_id'],
    defaultSort: { field: 'started_at', order: 'desc' },
  },
  visitorLifecycleActorDailyFact: {
    table: 'visitor_lifecycle_actor_daily_facts',
    search: ['actor_key', 'day', 'segment_at_day_start'],
    defaultSort: { field: 'day', order: 'asc' },
  },
  visitorLifecycleDaySnapshot: {
    table: 'visitor_lifecycle_day_snapshots',
    search: ['day', 'status'],
    defaultSort: { field: 'day', order: 'asc' },
  },
  abandonedCartCase: {
    table: 'abandoned_cart_cases',
    search: ['cart_id', 'email', 'category'],
    defaultSort: { field: 'last_action_at', order: 'desc' },
  },
  abandonedCartMessage: {
    table: 'abandoned_cart_messages',
    search: ['cart_id', 'email', 'channel', 'status'],
    defaultSort: { field: 'created_at', order: 'desc' },
  },
  abandonedCartCheck: {
    table: 'abandoned_cart_checks',
    search: ['cart_id', 'email', 'source', 'status'],
    defaultSort: { field: 'checked_at', order: 'desc' },
  },
  klaviyoEvent: {
    table: 'klaviyo_events',
    search: ['profile_id', 'email', 'metric', 'event_id'],
    defaultSort: { field: 'datetime', order: 'desc' },
  },
  identityResolutionLog: {
    table: 'identity_resolution_logs',
    search: ['event_id', 'distinct_id', 'email', 'source'],
    defaultSort: { field: 'created_at', order: 'desc' },
  },
}

const COLUMNS_BY_TABLE = new Map()

export default {
  async fetch(req) {
    const started = nowMs()
    const auth = requireAdmin(req)
    if (!auth) return unauthorized()
    const authDone = nowMs()

    if (req.method !== 'POST') return json({ type: 'METHOD_NOT_ALLOWED', message: 'POST required' }, { status: 405 })

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return json({ type: 'INVALID_REQUEST', message: 'Invalid graph body' }, { status: 400 })
    }

    const entity = ENTITIES[body.entity]
    if (!entity) {
      return json({ type: 'INVALID_ENTITY', message: `Unsupported entity: ${String(body.entity)}` }, { status: 400 })
    }

    const table = entity.table
    const columns = await columnsFor(table)
    const queryDone = nowMs()

    const limit = clampInt(body.pagination?.limit ?? body.pagination?.take, 50, 1, 200)
    const offset = clampInt(body.pagination?.offset ?? body.pagination?.skip, 0, 0, 1_000_000)
    const fields = normalizeFields(body.fields, columns, body.entity)
    const sort = normalizeSort(body.sort, entity.defaultSort, columns)
    const where = buildWhere({ filters: body.filters, q: body.q, entity, columns })
    const params = where.params
    params.push(limit, offset)
    const limitIdx = params.length - 1
    const offsetIdx = params.length
    const deletedFilter = columns.has('deleted_at') ? ' AND deleted_at IS NULL' : ''
    const select = fields.map((field) => selectExpression(body.entity, field, columns)).join(', ')

    const rows = await db().unsafe(
      `SELECT ${select}, COUNT(*) OVER()::text AS __total_count
         FROM ${table}
        WHERE 1=1${deletedFilter}${where.sql}
        ORDER BY ${quoteIdent(sort.field)} ${sort.order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    )
    const dbDone = nowMs()

    const count = Number(rows[0]?.__total_count ?? 0)
    const data = rows.map((row) => {
      const out = {}
      for (const [key, value] of Object.entries(row)) {
        if (key === '__total_count') continue
        out[key] = serialize(value)
      }
      return out
    })
    const serializeDone = nowMs()

    return json(
      { data, count },
      {
        headers: {
          'server-timing': timingHeader({
            auth: authDone - started,
            schema: queryDone - authDone,
            query: dbDone - queryDone,
            serialize: serializeDone - dbDone,
            total: serializeDone - started,
          }),
        },
      },
    )
  },
}

async function columnsFor(table) {
  if (COLUMNS_BY_TABLE.has(table)) return COLUMNS_BY_TABLE.get(table)
  const rows = await db().unsafe(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1`,
    [table],
  )
  const columns = new Set(rows.map((row) => row.column_name))
  COLUMNS_BY_TABLE.set(table, columns)
  return columns
}

function normalizeFields(input, columns, entity) {
  const requested = Array.isArray(input) && input.length > 0 ? input : [...columns]
  const fields = new Set(['id'])
  for (const field of requested) {
    if (typeof field !== 'string') continue
    if (columns.has(field) || (entity === 'customerGroup' && field === 'customers')) fields.add(field)
  }
  return [...fields]
}

function normalizeSort(input, fallback, columns) {
  const field = typeof input?.field === 'string' && columns.has(input.field) ? input.field : fallback.field
  const order = input?.order === 'asc' ? 'asc' : 'desc'
  return { field, order }
}

function buildWhere({ filters, q, entity, columns }) {
  const parts = []
  const params = []

  if (filters && typeof filters === 'object') {
    for (const [field, value] of Object.entries(filters)) {
      if (!columns.has(field)) continue
      appendFilter(parts, params, field, value)
    }
  }

  if (typeof q === 'string' && q.trim()) {
    const needle = `%${q.trim().toLowerCase()}%`
    const searchCols = entity.search.filter((field) => columns.has(field))
    if (searchCols.length > 0) {
      const clauses = searchCols.map((field) => {
        params.push(needle)
        return `lower(coalesce(${quoteIdent(field)}::text, '')) LIKE $${params.length}`
      })
      parts.push(` AND (${clauses.join(' OR ')})`)
    }
  }

  return { sql: parts.join(''), params }
}

function appendFilter(parts, params, field, value) {
  const column = quoteIdent(field)
  if (Array.isArray(value)) {
    const scalarValues = value.filter((entry) => typeof entry !== 'object' || entry == null)
    const objectValues = value.filter((entry) => typeof entry === 'object' && entry != null)
    const clauses = []
    if (scalarValues.length > 0) {
      params.push(scalarValues)
      clauses.push(`${column} = ANY($${params.length}::text[])`)
    }
    for (const entry of objectValues) {
      if (entry.$null) clauses.push(`${column} IS NULL`)
      if (entry.$notnull) clauses.push(`${column} IS NOT NULL`)
    }
    if (clauses.length > 0) parts.push(` AND (${clauses.join(' OR ')})`)
    return
  }

  if (value && typeof value === 'object') {
    if (value.$null) {
      parts.push(` AND ${column} IS NULL`)
      return
    }
    if (value.$notnull) {
      parts.push(` AND ${column} IS NOT NULL`)
      return
    }
    if (value.$gte != null) {
      params.push(value.$gte)
      parts.push(` AND ${column} >= $${params.length}`)
    }
    if (value.$gt != null) {
      params.push(value.$gt)
      parts.push(` AND ${column} > $${params.length}`)
    }
    if (value.$lte != null) {
      params.push(value.$lte)
      parts.push(` AND ${column} <= $${params.length}`)
    }
    if (value.$lt != null) {
      params.push(value.$lt)
      parts.push(` AND ${column} < $${params.length}`)
    }
    if (Array.isArray(value.$in)) {
      params.push(value.$in)
      parts.push(` AND ${column} = ANY($${params.length}::text[])`)
    }
    return
  }

  params.push(value)
  parts.push(` AND ${column} = $${params.length}`)
}

function selectExpression(entity, field, columns) {
  if (entity === 'customerGroup' && field === 'customers') {
    return `(SELECT COUNT(*)::int FROM customer_customer_group ccg WHERE ccg.customer_group_id = customer_groups.id) AS customers`
  }
  if (!columns.has(field)) return 'NULL'
  return quoteIdent(field)
}

function quoteIdent(value) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new RangeError(`Invalid identifier: ${value}`)
  return `"${value}"`
}

function serialize(value) {
  if (value instanceof Date) return iso(value)
  return value
}
