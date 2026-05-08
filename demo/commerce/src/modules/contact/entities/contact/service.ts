// Custom service methods for the Contact entity.
//
// `upsertWithReplace` is exposed here so commands can do bulk upsert via
// `step.service.contact.upsertWithReplace(...)` instead of reaching into
// the DB layer with raw SQL. The auto-generated CRUD doesn't include this
// method; it's defined on the underlying TypedRepository and we surface it
// explicitly so the command layer stays inside the framework's CQRS contract
// (compensation skipped for bulk upsert by design — see SnapshotRepository).

export default defineService('contact', ({ db }) => ({
  upsertWithReplace: async (rows: Record<string, unknown>[], replaceFields?: string[], conflictTarget?: string[]) => {
    return db.upsertWithReplace(rows, replaceFields, conflictTarget)
  },
}))
