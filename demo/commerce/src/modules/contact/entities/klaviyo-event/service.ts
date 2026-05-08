// Custom service methods for the KlaviyoEvent entity.
//
// Surfaces `upsertWithReplace` so the sync-klaviyo-events command can bulk
// upsert events via `step.service.klaviyoEvent.upsertWithReplace(...)`
// (with `replaceFields=[]` since events are immutable upstream — equivalent
// to `INSERT ... ON CONFLICT DO NOTHING` apart from `updated_at` being
// touched, which is harmless for read paths).
//
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

export default defineService('klaviyoEvent', ({ db }) => ({
  upsertWithReplace: async (rows: Record<string, unknown>[], replaceFields?: string[], conflictTarget?: string[]) => {
    return db.upsertWithReplace(reviveDateFields(rows), replaceFields, conflictTarget)
  },
}))
