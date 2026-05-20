export default defineService('visitorLifecycleDaySnapshot', ({ db }) => ({
  upsertWithReplace: async (rows: Record<string, unknown>[], replaceFields?: string[], conflictTarget?: string[]) => {
    return db.upsertWithReplace(rows, replaceFields, conflictTarget)
  },
}))
