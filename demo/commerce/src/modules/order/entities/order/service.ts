// Custom service methods for the Order entity.
//
// `upsertWithReplace` is exposed so sync-from-shopify can bulk-upsert via
// `step.service.order.upsertWithReplace(...)`.

export default defineService('order', ({ db }) => ({
  upsertWithReplace: async (rows: Record<string, unknown>[], replaceFields?: string[], conflictTarget?: string[]) => {
    return db.upsertWithReplace(rows, replaceFields, conflictTarget)
  },
}))
