// Custom service methods for the Contact entity.
//
// `upsertWithReplace` is exposed so commands can do bulk upsert via
// `step.service.contact.upsertWithReplace(...)`. The auto-generated CRUD
// doesn't include it; we surface it explicitly so the command layer stays
// inside the framework's CQRS contract (compensation skipped for bulk
// upsert by design; the repository implementation handles the write.

export default defineService('contact', ({ db }) => ({
  upsertWithReplace: async (rows: Record<string, unknown>[], replaceFields?: string[], conflictTarget?: string[]) => {
    return db.upsertWithReplace(rows, replaceFields, conflictTarget)
  },
}))
