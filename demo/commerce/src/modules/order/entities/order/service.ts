// Custom service methods for the Order entity.
//
// `upsertWithReplace` is exposed here so the sync-contacts-from-shopify
// command can do bulk upsert via `step.service.order.upsertWithReplace(...)`.
// Date revival: see contact/service.ts for the rationale (step.action JSON
// serialization at workflow_runs.steps boundaries strips Date prototypes).

function reviveDateFields<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => {
    const out = { ...row }
    for (const [key, value] of Object.entries(row)) {
      if (key.endsWith('_at') && typeof value === 'string') {
        const d = new Date(value)
        if (!Number.isNaN(d.getTime())) (out as Record<string, unknown>)[key] = d
      }
    }
    return out
  })
}

export default defineService('order', ({ db }) => ({
  upsertWithReplace: async (rows: Record<string, unknown>[], replaceFields?: string[], conflictTarget?: string[]) => {
    return db.upsertWithReplace(reviveDateFields(rows), replaceFields, conflictTarget)
  },
}))
