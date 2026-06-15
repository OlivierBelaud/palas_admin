import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, type SQL } from 'drizzle-orm'

type DrizzleDb = {
  select: (selection?: Record<string, unknown>) => any
}

type Table = Record<string, unknown>

export interface DrizzleReadContext {
  db: unknown
  schema: Record<string, unknown>
}

export interface ReadRowsConfig {
  entity: string
  fields?: string[]
  filters?: Record<string, unknown>
  sort?: Record<string, 'asc' | 'desc'> | { field?: string; order?: 'asc' | 'desc' }
  pagination?: { limit?: number; offset?: number; take?: number; skip?: number }
}

export async function readRows<T = any>(ctx: DrizzleReadContext, config: ReadRowsConfig): Promise<T[]> {
  const db = ctx.db as DrizzleDb
  const table = resolveTable(ctx.schema, config.entity)
  const where = buildWhere(table, config.filters)
  const orderBy = buildOrderBy(table, config.sort)
  const pagination = normalizePagination(config.pagination)
  const selection = buildSelection(table, config.fields)

  let query = db.select(selection).from(table) as any
  if (where) query = query.where(where)
  if (orderBy.length > 0) query = query.orderBy(...orderBy)
  if (pagination.limit !== undefined) query = query.limit(pagination.limit)
  if (pagination.offset !== undefined) query = query.offset(pagination.offset)
  return (await query) as T[]
}

export async function readRowsAndCount<T = any>(
  ctx: DrizzleReadContext,
  config: ReadRowsConfig,
): Promise<[T[], number]> {
  const db = ctx.db as DrizzleDb
  const table = resolveTable(ctx.schema, config.entity)
  const where = buildWhere(table, config.filters)

  let countQuery = db.select({ value: count() }).from(table) as any
  if (where) countQuery = countQuery.where(where)
  const countRows = (await countQuery) as Array<{ value: number | string | bigint }>
  const rows = await readRows<T>(ctx, config)
  return [rows, Number(countRows[0]?.value ?? 0)]
}

export function resolveTable(schema: Record<string, unknown>, entity: string): Table {
  const candidates = [entity, entityToTableKey(entity), entityToSnakeTableName(entity)]
  for (const key of candidates) {
    const table = schema[key]
    if (table && typeof table === 'object') return table as Table
  }
  throw new MantaError('UNEXPECTED_STATE', `Drizzle table for entity "${entity}" is not available`)
}

function buildSelection(table: Table, fields: string[] | undefined): Record<string, unknown> | undefined {
  if (!fields || fields.length === 0 || fields.includes('*') || fields.some((field) => field.includes('.'))) {
    return undefined
  }

  const selection: Record<string, unknown> = {}
  for (const field of fields) {
    const column = table[field]
    if (!column) throw new MantaError('UNEXPECTED_STATE', `Drizzle column "${field}" is not available`)
    selection[field] = column
  }
  return selection
}

function buildWhere(table: Table, filters: Record<string, unknown> | undefined): SQL | undefined {
  if (!filters || Object.keys(filters).length === 0) return undefined

  const clauses: SQL[] = []
  for (const [field, value] of Object.entries(filters)) {
    if (field === '$or') {
      if (!Array.isArray(value)) throw new MantaError('INVALID_DATA', '$or filter must be an array')
      const nested = value.map((item) => buildWhere(table, item as Record<string, unknown>)).filter(Boolean) as SQL[]
      if (nested.length > 0) {
        const clause = or(...nested)
        if (clause) clauses.push(clause)
      }
      continue
    }

    const column = table[field]
    if (!column) throw new MantaError('UNEXPECTED_STATE', `Drizzle column "${field}" is not available`)
    const clause = buildFieldWhere(column, value)
    if (clause) clauses.push(clause)
  }

  if (clauses.length === 0) return undefined
  return clauses.length === 1 ? clauses[0] : and(...clauses)
}

function buildFieldWhere(column: unknown, value: unknown): SQL | undefined {
  if (value === null) return isNull(column as never)

  if (isPlainObject(value)) {
    const clauses: SQL[] = []
    for (const [op, opValue] of Object.entries(value)) {
      switch (op) {
        case '$in':
          clauses.push(inArray(column as never, opValue as never[]))
          break
        case '$gte':
          clauses.push(gte(column as never, opValue as never))
          break
        case '$gt':
          clauses.push(gt(column as never, opValue as never))
          break
        case '$lte':
          clauses.push(lte(column as never, opValue as never))
          break
        case '$lt':
          clauses.push(lt(column as never, opValue as never))
          break
        case '$ne':
          clauses.push(opValue === null ? isNotNull(column as never) : ne(column as never, opValue as never))
          break
        case '$notnull':
          if (opValue) clauses.push(isNotNull(column as never))
          break
        default:
          throw new MantaError('INVALID_DATA', `Unsupported Drizzle read filter operator "${op}"`)
      }
    }
    if (clauses.length === 0) return undefined
    return clauses.length === 1 ? clauses[0] : and(...clauses)
  }

  return eq(column as never, value as never)
}

function buildOrderBy(table: Table, sort: ReadRowsConfig['sort']): SQL[] {
  if (!sort) return []
  if ('field' in sort) {
    if (!sort.field) return []
    const column = table[sort.field]
    if (!column) throw new MantaError('UNEXPECTED_STATE', `Drizzle column "${sort.field}" is not available`)
    return [sort.order === 'asc' ? asc(column as never) : desc(column as never)]
  }

  return Object.entries(sort).map(([field, order]) => {
    const column = table[field]
    if (!column) throw new MantaError('UNEXPECTED_STATE', `Drizzle column "${field}" is not available`)
    return order === 'asc' ? asc(column as never) : desc(column as never)
  })
}

function normalizePagination(pagination: ReadRowsConfig['pagination']): { limit?: number; offset?: number } {
  if (!pagination) return {}
  return {
    limit: pagination.limit ?? pagination.take,
    offset: pagination.offset ?? pagination.skip,
  }
}

function entityToTableKey(entityName: string): string {
  const name = entityName.charAt(0).toLowerCase() + entityName.slice(1)
  if (name.endsWith('s') || name.endsWith('x') || name.endsWith('ch') || name.endsWith('sh')) return `${name}es`
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`
  return `${name}s`
}

function entityToSnakeTableName(entityName: string): string {
  const snake = entityName
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase()
  if (snake.endsWith('s') || snake.endsWith('x') || snake.endsWith('ch') || snake.endsWith('sh')) return `${snake}es`
  if (snake.endsWith('y') && !/[aeiou]y$/i.test(snake)) return `${snake.slice(0, -1)}ies`
  return `${snake}s`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
}
