// Custom service methods for the KlaviyoEvent entity.
//
// Surfaces `upsertWithReplace` so the sync-klaviyo-events command can bulk
// upsert events via `step.service.klaviyoEvent.upsertWithReplace(...)`
// (with `replaceFields=[]` since events are immutable upstream — equivalent
// to `INSERT ... ON CONFLICT DO NOTHING` apart from `updated_at` being
// touched, which is harmless for read paths).

export default defineService('klaviyoEvent', ({ db }) => ({
  upsertWithReplace: async (rows: Record<string, unknown>[], replaceFields?: string[], conflictTarget?: string[]) => {
    return db.upsertWithReplace(rows, replaceFields, conflictTarget)
  },
}))
