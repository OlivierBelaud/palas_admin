export default defineCommand({
  name: 'purgeEmptyCarts',
  description:
    'Delete all carts with zero items (item_count = 0 or NULL) and their associated events. Uses a CTE for atomic cascade delete.',
  input: z.object({}),
  workflow: async (_input, { step, log }) => {
    // MantaInfra.db is typed as `unknown` (framework-agnostic); narrow to the raw() shape we need.
    type RawDb = { raw: <T>(sql: string, params?: unknown[]) => Promise<T[]> }
    const result = await step.action('purge-empty-carts', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.infra.db as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        // Atomic CTE: find empty carts, delete their events, then delete the carts
        const rows = await db.raw<{ carts_deleted: string; events_deleted: string }>(
          `WITH empty_carts AS (
            SELECT id FROM carts WHERE item_count = 0 OR item_count IS NULL
          ),
          deleted_events AS (
            DELETE FROM cart_events WHERE cart_id IN (SELECT id FROM empty_carts)
            RETURNING id
          ),
          deleted_carts AS (
            DELETE FROM carts WHERE id IN (SELECT id FROM empty_carts)
            RETURNING id
          )
          SELECT
            (SELECT COUNT(*) FROM deleted_carts) AS carts_deleted,
            (SELECT COUNT(*) FROM deleted_events) AS events_deleted`,
        )

        const stats = rows[0] ?? { carts_deleted: '0', events_deleted: '0' }
        return {
          carts_deleted: Number(stats.carts_deleted),
          events_deleted: Number(stats.events_deleted),
        }
      },
      compensate: async (output, _ctx) => {
        // Non-compensable operation — deleted data cannot be restored
        log.warn(
          `[purgeEmptyCarts] Cannot compensate: ${output.carts_deleted} carts and ${output.events_deleted} events were already deleted`,
        )
      },
    })({})

    log.info(`[purgeEmptyCarts] Purged ${result.carts_deleted} empty carts, ${result.events_deleted} events`)

    return result
  },
})
