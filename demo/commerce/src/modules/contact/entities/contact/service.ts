// Custom service methods for the Contact entity.
//
// `upsertWithReplace` is exposed here so commands can do bulk upsert via
// `step.service.contact.upsertWithReplace(...)` instead of reaching into
// the DB layer with raw SQL. The auto-generated CRUD doesn't include this
// method; it's defined on the underlying TypedRepository and we surface it
// explicitly so the command layer stays inside the framework's CQRS contract
// (compensation skipped for bulk upsert by design — see SnapshotRepository).
//
// Date revival: step.action persists output as JSON in workflow_runs.steps,
// so any Date that travels through a step boundary comes back as an ISO
// string. Drizzle's pgTimestamp.mapToDriverValue calls value.toISOString()
// and crashes on a string. We revive any *_at field (Manta convention) here
// so callers don't have to remember.

export default defineService('contact', ({ db }) => ({
  upsertWithReplace: async (rows: Record<string, unknown>[], replaceFields?: string[], conflictTarget?: string[]) => {
    return db.upsertWithReplace(rows, replaceFields, conflictTarget)
  },
}))
