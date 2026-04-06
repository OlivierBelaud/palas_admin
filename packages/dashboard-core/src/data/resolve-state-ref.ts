export function resolveStateRef(ref: unknown, state: Record<string, unknown>): unknown {
  if (ref === null) return null
  if (ref === undefined) return undefined

  if (
    typeof ref === 'object' &&
    ref !== null &&
    '$state' in ref &&
    typeof (ref as Record<string, unknown>).$state === 'string'
  ) {
    const path = (ref as { $state: string }).$state
    const segments = path.split('/').filter(Boolean)
    let current: unknown = state
    for (const segment of segments) {
      if (current === null || current === undefined) return undefined
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[segment]
      } else {
        return undefined
      }
    }
    return current
  }

  return ref
}
