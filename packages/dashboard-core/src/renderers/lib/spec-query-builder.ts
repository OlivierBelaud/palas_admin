/**
 * Utility functions for SpecRenderer query building and response parsing.
 */

const RESERVED_SEARCH_KEYS = new Set(['q', 'offset', 'order', 'limit'])

/**
 * Extract filters from URL search params, splitting comma-separated values into arrays.
 * Keys in `reserved` are skipped.
 */
export function extractFiltersFromSearchParams(
  searchParams: URLSearchParams,
  reserved: Set<string> = RESERVED_SEARCH_KEYS,
): Record<string, string | string[]> {
  const filters: Record<string, string | string[]> = {}
  searchParams.forEach((value, key) => {
    if (!reserved.has(key) && value) {
      filters[key] = value.includes(',') ? value.split(',') : value
    }
  })
  return filters
}

/**
 * Parse the raw API response into a normalised shape.
 *
 * Strategy (deterministic):
 * 1. Look for a `data` key first (convention).
 * 2. For lists: find the first key whose value is an array.
 * 3. For detail/form: find the first key whose value is a non-array object.
 */
export function parseSpecResponse(
  rawData: unknown,
  specType: 'list' | 'detail' | 'form',
): { data: Record<string, unknown>; items: unknown[] } {
  if (!rawData || typeof rawData !== 'object') {
    return { data: {} as Record<string, unknown>, items: [] }
  }

  const record = rawData as Record<string, unknown>

  if (specType === 'list') {
    // Convention: prefer `data` key if it is an array
    if (Array.isArray(record.data)) {
      return { data: record, items: record.data }
    }
    // Fallback: first key that holds an array
    const arrayKey = Object.keys(record).find((k) => Array.isArray(record[k]))
    return {
      data: record,
      items: arrayKey ? (record[arrayKey] as unknown[]) : [],
    }
  }

  // detail / form
  // Convention: prefer `data` key if it is a non-array object
  if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
    return { data: record.data as Record<string, unknown>, items: [] }
  }
  // Fallback: first key that holds a non-array object
  const objectKey = Object.keys(record).find(
    (k) => typeof record[k] === 'object' && record[k] !== null && !Array.isArray(record[k]),
  )
  return {
    data: objectKey ? (record[objectKey] as Record<string, unknown>) : record,
    items: [],
  }
}
