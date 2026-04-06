// Manta query graph → HogQL SQL translator.

import { FIELD_MAP } from './schema'

/**
 * Escape a raw value for safe inclusion in a HogQL string.
 * Numbers and booleans are passed through, strings are single-quoted with ' → ''.
 */
export function escapeValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return `'${String(v).replace(/'/g, "''")}'`
}

/**
 * Translate a Manta filter map into a HogQL `WHERE` clause.
 * Only equality, IN (array value), and the special `after`/`before` timestamp filters are supported.
 */
export function translateFilters(entity: string, filters: Record<string, unknown> | undefined): string {
  if (!filters || Object.keys(filters).length === 0) return ''
  const fieldMap = FIELD_MAP[entity] ?? {}
  const clauses: string[] = []

  for (const [key, value] of Object.entries(filters)) {
    if (key === 'after') {
      clauses.push(`timestamp > ${escapeValue(value)}`)
      continue
    }
    if (key === 'before') {
      clauses.push(`timestamp < ${escapeValue(value)}`)
      continue
    }
    const column = fieldMap[key] ?? key
    if (Array.isArray(value)) {
      const list = value.map(escapeValue).join(', ')
      clauses.push(`${column} IN (${list})`)
    } else {
      clauses.push(`${column} = ${escapeValue(value)}`)
    }
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
}

/**
 * Normalize a raw HogQL result row (keyed by ClickHouse column names) into the Manta entity shape.
 */
export function normalizeRow(entity: string, row: Record<string, unknown>): Record<string, unknown> {
  if (entity === 'posthogEvent') {
    const props = (row.properties as Record<string, unknown> | null) ?? {}
    return {
      id: row.uuid ?? row.id,
      event: row.event,
      distinctId: row.distinct_id,
      timestamp: row.timestamp,
      properties: props,
      url: props.$current_url ?? null,
      personId: row.person_id ?? null,
    }
  }
  if (entity === 'posthogPerson') {
    const props = (row.properties as Record<string, unknown> | null) ?? {}
    return {
      id: row.id,
      distinctId: row.distinct_id,
      email: (props.email as string | undefined) ?? null,
      name: (props.name as string | undefined) ?? null,
      createdAt: row.created_at,
      properties: props,
    }
  }
  return row
}
