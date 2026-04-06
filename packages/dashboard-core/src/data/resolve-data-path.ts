export function resolveDataPath(data: unknown, path: string): unknown {
  if (data === undefined || data === null) {
    if (path && data === undefined) return undefined
    if (!path) return data
    return undefined
  }

  const segments = path.split('.')
  let current: unknown = data

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]

    if (current === null || current === undefined) return undefined

    if (segment === '$count' && Array.isArray(current)) {
      return current.length
    }

    if (segment === 'length' && Array.isArray(current)) {
      return current.length
    }

    if (segment.startsWith('$sum:') && Array.isArray(current)) {
      const field = segment.slice(5)
      return current.reduce(
        (sum: number, item: Record<string, unknown>) => sum + (typeof item[field] === 'number' ? item[field] : 0),
        0,
      )
    }

    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[parseInt(segment, 10)]
      continue
    }

    if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[segment]
      continue
    }

    return undefined
  }

  return current
}
