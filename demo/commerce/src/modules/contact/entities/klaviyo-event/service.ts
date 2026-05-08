// Custom service methods for the KlaviyoEvent entity.
//
// Surfaces `upsertWithReplace` so sync-klaviyo-events can bulk upsert via
// `step.service.klaviyoEvent.upsertWithReplace(...)` with `replaceFields=[]`
// (events are immutable upstream — equivalent to ON CONFLICT DO NOTHING).

export default defineService('klaviyoEvent', ({ db }) => ({
  upsertWithReplace: async (rows: Record<string, unknown>[], replaceFields?: string[], conflictTarget?: string[]) => {
    return db.upsertWithReplace(rows, replaceFields, conflictTarget)
  },
}))
