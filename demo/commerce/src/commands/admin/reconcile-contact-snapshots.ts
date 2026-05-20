interface RawDb {
  raw<T = unknown>(query: string, params?: unknown[]): Promise<T[]>
}

export default defineCommand({
  name: 'reconcileContactSnapshots',
  description: 'Dry-run normalization and order aggregate reconciliation for Contact snapshots.',
  input: z.object({
    dryRun: z.boolean().default(true),
  }),
  workflow: async (input, { step, log }) => {
    return await step.action('reconcile-contact-snapshots', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        const [before] = await db.raw<{
          contacts: number
          bad_locale: number
          order_count_mismatches: number
          first_order_mismatches: number
          last_order_mismatches: number
        }>(CONTACT_AUDIT_SQL)

        if (!input.dryRun) {
          await db.raw(`
            UPDATE contacts
               SET locale = CASE
                 WHEN lower(locale) LIKE 'fr%' THEN 'fr'
                 WHEN lower(locale) LIKE 'en%' THEN 'en'
                 ELSE 'en'
               END,
               updated_at = NOW()
             WHERE locale IS NULL
                OR locale NOT IN ('fr', 'en')
          `)

          await db.raw(`
            WITH linked_orders AS (
              SELECT DISTINCT oc.contact_id, o.id, o.total_price, o.placed_at
                FROM order_contact oc
                JOIN orders o ON o.id::text = oc.order_id
            ),
            order_agg AS (
              SELECT
                contact_id,
                count(*)::int AS orders_count,
                coalesce(sum(total_price), 0)::float AS total_spent,
                min(placed_at) AS first_order_at,
                max(placed_at) AS last_order_at
              FROM linked_orders
              GROUP BY contact_id
            )
            UPDATE contacts c
               SET orders_count = a.orders_count,
                   total_spent = a.total_spent,
                   first_order_at = a.first_order_at,
                   last_order_at = a.last_order_at,
                   updated_at = NOW()
              FROM order_agg a
             WHERE c.id::text = a.contact_id
               AND (
                 c.orders_count IS DISTINCT FROM a.orders_count
                 OR c.total_spent IS DISTINCT FROM a.total_spent
                 OR c.first_order_at IS DISTINCT FROM a.first_order_at
                 OR c.last_order_at IS DISTINCT FROM a.last_order_at
               )
          `)
        }

        const [after] = await db.raw<{
          contacts: number
          bad_locale: number
          order_count_mismatches: number
          first_order_mismatches: number
          last_order_mismatches: number
        }>(CONTACT_AUDIT_SQL)

        log.info(
          `[reconcileContactSnapshots] dry_run=${input.dryRun} bad_locale ${before.bad_locale}->${after.bad_locale} order_count_mismatches ${before.order_count_mismatches}->${after.order_count_mismatches}`,
        )

        return { dry_run: input.dryRun, before, after }
      },
      compensate: async () => {},
    })({})
  },
})

const CONTACT_AUDIT_SQL = `
WITH local_order_agg AS (
  SELECT
    contact_id,
    count(*)::int AS local_orders,
    min(placed_at) AS first_order_at,
    max(placed_at) AS last_order_at
  FROM (
    SELECT DISTINCT oc.contact_id, o.id, o.placed_at
      FROM order_contact oc
      JOIN orders o ON o.id::text = oc.order_id
  ) linked_orders
  GROUP BY contact_id
)
SELECT
  (SELECT count(*)::int FROM contacts) AS contacts,
  (SELECT count(*)::int FROM contacts WHERE locale IS NULL OR locale NOT IN ('fr', 'en')) AS bad_locale,
  count(*) FILTER (WHERE c.orders_count <> a.local_orders)::int AS order_count_mismatches,
  count(*) FILTER (WHERE c.first_order_at IS DISTINCT FROM a.first_order_at)::int AS first_order_mismatches,
  count(*) FILTER (WHERE c.last_order_at IS DISTINCT FROM a.last_order_at)::int AS last_order_mismatches
FROM local_order_agg a
JOIN contacts c ON c.id::text = a.contact_id
`
