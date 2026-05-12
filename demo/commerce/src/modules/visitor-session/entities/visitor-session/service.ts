// Custom service methods for the VisitorSession entity.
//
// `upsertWithReplace` is exposed so commands can do bulk upsert via
// `step.service.visitorSession.upsertWithReplace(...)` with a multi-column
// conflict target `['distinct_id', 'session_id']`. The auto-generated CRUD
// doesn't include it; we surface it explicitly so the command layer stays
// inside the framework's CQRS contract.

export default defineService('visitorSession', ({ db }) => ({
  upsertWithReplace: async (rows: Record<string, unknown>[], replaceFields?: string[], conflictTarget?: string[]) => {
    return db.upsertWithReplace(rows, replaceFields, conflictTarget)
  },
}))
