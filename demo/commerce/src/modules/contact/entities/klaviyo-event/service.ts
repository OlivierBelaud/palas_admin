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

export default defineService('klaviyoEvent', ({ db }) => ({
  upsertWithReplace: async (rows: Record<string, unknown>[], replaceFields?: string[], conflictTarget?: string[]) => {
    return db.upsertWithReplace(rows, replaceFields, conflictTarget)
  },
}))
