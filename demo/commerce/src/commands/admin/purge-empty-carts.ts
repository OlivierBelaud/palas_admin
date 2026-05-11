export default defineCommand({
  name: 'purgeEmptyCarts',
  description: 'Delete all carts with zero items (item_count = 0 or NULL).',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    // MantaInfra.db is typed as `unknown` (framework-agnostic); narrow to the raw() shape we need.
    type RawDb = { raw: <T>(sql: string, params?: unknown[]) => Promise<T[]> }
    const result = await step.action('purge-empty-carts', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.infra.db as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        const rows = await db.raw<{ carts_deleted: string }>(
          `WITH deleted AS (
             DELETE FROM carts WHERE item_count = 0 OR item_count IS NULL RETURNING id
           )
           SELECT COUNT(*)::text AS carts_deleted FROM deleted`,
        )

        const stats = rows[0] ?? { carts_deleted: '0' }
        return {
          carts_deleted: Number(stats.carts_deleted),
        }
      },
      compensate: async (output, _ctx) => {
        // Non-compensable operation — deleted data cannot be restored
        log.warn(`[purgeEmptyCarts] Cannot compensate: ${output.carts_deleted} carts were already deleted`)
      },
    })({})

    log.info(`[purgeEmptyCarts] Purged ${result.carts_deleted} empty carts`)

    return result
  },
})
