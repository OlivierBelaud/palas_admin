// Custom service methods for the Order entity.
//
// `upsertWithReplace` is exposed here so the sync-contacts-from-shopify
// command can do bulk upsert via `step.service.order.upsertWithReplace(...)`.
// Date revival: see contact/service.ts for the rationale (step.action JSON
// serialization at workflow_runs.steps boundaries strips Date prototypes).

export default defineService('order', ({ db }) => ({
  upsertWithReplace: async (rows: Record<string, unknown>[], replaceFields?: string[], conflictTarget?: string[]) => {
    return db.upsertWithReplace(rows, replaceFields, conflictTarget)
  },
}))
