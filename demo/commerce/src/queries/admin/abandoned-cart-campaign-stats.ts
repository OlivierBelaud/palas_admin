import { resolveRawDb } from '../../utils/raw-db'

export default defineQuery({
  name: 'abandoned-cart-campaign-stats',
  description: 'Abandoned-cart campaign KPIs from SQL aggregates.',
  input: z.object({
    days: z.number().int().positive().max(180).default(30),
  }),
  handler: async (input, ctx) => {
    const since = new Date(Date.now() - (input.days ?? 30) * 86400 * 1000)
    const rows = await resolveRawDb(ctx).raw<StatsRow>(
      `WITH cases_window AS (
         SELECT *
           FROM abandoned_cart_cases
          WHERE deleted_at IS NULL
            AND opened_at >= $1::timestamptz
       ),
       messages_window AS (
         SELECT *
           FROM abandoned_cart_messages
          WHERE deleted_at IS NULL
            AND scheduled_for >= $1::timestamptz
       ),
       recovered AS (
         SELECT *
           FROM cases_window
          WHERE status = 'recovered'
       )
       SELECT
         (SELECT COUNT(*) FROM cases_window)::text AS total_cases,
         (SELECT COUNT(*) FROM cases_window WHERE status = 'open')::text AS open_cases,
         (SELECT COUNT(*) FROM recovered)::text AS recovered_cases,
         (SELECT COALESCE(SUM(recovered_amount), 0) FROM recovered)::text AS recovered_revenue,
         (SELECT COUNT(*) FROM messages_window WHERE status = 'sent')::text AS sent_messages,
         (SELECT COUNT(*) FROM messages_window WHERE status = 'skipped')::text AS skipped_messages,
         (SELECT COUNT(*) FROM messages_window WHERE status = 'skipped' AND skip_reason = 'shopify_order_found')::text
           AS skipped_shopify,
         (SELECT COUNT(*) FROM messages_window WHERE status = 'skipped' AND skip_reason = 'klaviyo_email_found')::text
           AS skipped_klaviyo,
         (SELECT COUNT(*) FROM messages_window WHERE status = 'skipped' AND skip_reason = 'opt_out')::text
           AS skipped_optout,
         (SELECT COUNT(*) FROM messages_window WHERE status = 'sent' AND message_type = 'abandoned_cart_1')::text
           AS email_1_sent,
         (SELECT COUNT(*) FROM messages_window m JOIN recovered c ON c.recovered_source_message_id = m.id
           WHERE m.status = 'sent' AND m.message_type = 'abandoned_cart_1')::text AS email_1_recovered,
         (SELECT COUNT(*) FROM messages_window WHERE status = 'sent' AND message_type = 'abandoned_cart_2')::text
           AS email_2_sent,
         (SELECT COUNT(*) FROM messages_window m JOIN recovered c ON c.recovered_source_message_id = m.id
           WHERE m.status = 'sent' AND m.message_type = 'abandoned_cart_2')::text AS email_2_recovered,
         (SELECT COUNT(*) FROM messages_window WHERE status = 'sent' AND message_type = 'abandoned_cart_3')::text
           AS email_3_sent,
         (SELECT COUNT(*) FROM messages_window m JOIN recovered c ON c.recovered_source_message_id = m.id
           WHERE m.status = 'sent' AND m.message_type = 'abandoned_cart_3')::text AS email_3_recovered,
         (SELECT COUNT(*) FROM messages_window WHERE status = 'sent' AND message_type = 'payment_help_1')::text
           AS payment_help_sent,
         (SELECT COUNT(*) FROM messages_window m JOIN recovered c ON c.recovered_source_message_id = m.id
           WHERE m.status = 'sent' AND m.message_type = 'payment_help_1')::text AS payment_help_recovered`,
      [since.toISOString()],
    )

    const row = rows[0] ?? emptyStats()
    const sentMessages = num(row.sent_messages)
    return {
      total_cases: num(row.total_cases),
      open_cases: num(row.open_cases),
      recovered_cases: num(row.recovered_cases),
      sent_messages: sentMessages,
      skipped_messages: num(row.skipped_messages),
      skipped_shopify: num(row.skipped_shopify),
      skipped_klaviyo: num(row.skipped_klaviyo),
      skipped_optout: num(row.skipped_optout),
      recovered_revenue: money(row.recovered_revenue),
      recovery_rate: rate(num(row.recovered_cases), sentMessages),
      email_1_sent: num(row.email_1_sent),
      email_1_recovered: num(row.email_1_recovered),
      email_1_recovery_rate: rate(num(row.email_1_recovered), num(row.email_1_sent)),
      email_2_sent: num(row.email_2_sent),
      email_2_recovered: num(row.email_2_recovered),
      email_2_recovery_rate: rate(num(row.email_2_recovered), num(row.email_2_sent)),
      email_3_sent: num(row.email_3_sent),
      email_3_recovered: num(row.email_3_recovered),
      email_3_recovery_rate: rate(num(row.email_3_recovered), num(row.email_3_sent)),
      payment_help_sent: num(row.payment_help_sent),
      payment_help_recovered: num(row.payment_help_recovered),
      payment_help_recovery_rate: rate(num(row.payment_help_recovered), num(row.payment_help_sent)),
    }
  },
})

interface StatsRow {
  total_cases: string
  open_cases: string
  recovered_cases: string
  recovered_revenue: string
  sent_messages: string
  skipped_messages: string
  skipped_shopify: string
  skipped_klaviyo: string
  skipped_optout: string
  email_1_sent: string
  email_1_recovered: string
  email_2_sent: string
  email_2_recovered: string
  email_3_sent: string
  email_3_recovered: string
  payment_help_sent: string
  payment_help_recovered: string
}

function emptyStats(): StatsRow {
  return {
    total_cases: '0',
    open_cases: '0',
    recovered_cases: '0',
    recovered_revenue: '0',
    sent_messages: '0',
    skipped_messages: '0',
    skipped_shopify: '0',
    skipped_klaviyo: '0',
    skipped_optout: '0',
    email_1_sent: '0',
    email_1_recovered: '0',
    email_2_sent: '0',
    email_2_recovered: '0',
    email_3_sent: '0',
    email_3_recovered: '0',
    payment_help_sent: '0',
    payment_help_recovered: '0',
  }
}

function num(value: string | number | null | undefined): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0
  return Number.isFinite(n) ? n : 0
}

function money(value: string | number | null | undefined): number {
  return Math.round(num(value) * 100) / 100
}

function rate(numValue: number, den: number): number {
  return den > 0 ? Math.round((numValue / den) * 1000) / 10 : 0
}
