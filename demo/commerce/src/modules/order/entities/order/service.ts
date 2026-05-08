// Custom service methods for the Order entity.
//
// Surfaces `upsertWithReplace` so the Shopify sync command can bulk upsert
// orders via `step.service.order.upsertWithReplace(...)` rather than
// `db.raw(...)`. See contact/service.ts for the rationale.

export default defineService('order', ({ db }) => ({
  upsertWithReplace: async (rows: Record<string, unknown>[], replaceFields?: string[], conflictTarget?: string[]) => {
    return db.upsertWithReplace(rows, replaceFields, conflictTarget)
  },
}))
