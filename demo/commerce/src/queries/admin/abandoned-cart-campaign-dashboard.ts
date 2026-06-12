import { resolveRawDb } from '../../utils/raw-db'

type MessageType = 'abandoned_cart_1' | 'abandoned_cart_2' | 'abandoned_cart_3' | 'payment_help_1'

const MESSAGE_TYPES: MessageType[] = ['abandoned_cart_1', 'abandoned_cart_2', 'abandoned_cart_3', 'payment_help_1']

export default defineQuery({
  name: 'abandoned-cart-campaign-dashboard',
  description: 'Abandoned-cart campaign KPIs and charts. Lists are loaded by paginated queries.',
  input: z.object({
    from: z.string(),
    to: z.string(),
  }),
  handler: async (input, ctx) => {
    const from = new Date(input.from)
    const to = new Date(input.to)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      throw new MantaError(
        'INVALID_DATA',
        `abandoned-cart-campaign-dashboard: invalid range from=${input.from} to=${input.to}`,
      )
    }

    const db = resolveRawDb(ctx)
    const [kpiRows, byTypeRows, skipRows, caseDayRows, messageDayRows, recoveredDayRows] = await Promise.all([
      db.raw<KpiRow>(
        `WITH window_messages AS (
           SELECT *
             FROM abandoned_cart_messages
            WHERE deleted_at IS NULL
              AND COALESCE(sent_at, updated_at, scheduled_for) >= $1::timestamptz
              AND COALESCE(sent_at, updated_at, scheduled_for) < $2::timestamptz
         ),
         sent_window AS (
           SELECT m.*
             FROM window_messages m
            WHERE m.status = 'sent'
         ),
         recovered_from_sent AS (
           SELECT sw.id, c.recovered_amount
             FROM sent_window sw
             JOIN abandoned_cart_cases c ON c.recovered_source_message_id = sw.id
            WHERE c.deleted_at IS NULL
         )
         SELECT
           (SELECT COUNT(*) FROM abandoned_cart_cases c
             WHERE c.deleted_at IS NULL AND c.opened_at >= $1::timestamptz AND c.opened_at < $2::timestamptz)::text
             AS cases_opened,
           (SELECT COUNT(*) FROM abandoned_cart_cases c
             WHERE c.deleted_at IS NULL AND c.status = 'open')::text
             AS open_cases_total,
           (SELECT COUNT(*) FROM abandoned_cart_cases c
             WHERE c.deleted_at IS NULL AND c.recovered_at >= $1::timestamptz AND c.recovered_at < $2::timestamptz)::text
             AS recovered_cases,
           (SELECT COALESCE(SUM(c.recovered_amount), 0) FROM abandoned_cart_cases c
             WHERE c.deleted_at IS NULL AND c.recovered_at >= $1::timestamptz AND c.recovered_at < $2::timestamptz)::text
             AS recovered_revenue,
           (SELECT COUNT(*) FROM sent_window)::text AS sent_messages,
           (SELECT COUNT(*) FROM window_messages WHERE status = 'skipped')::text AS skipped_messages,
           (SELECT COUNT(*) FROM window_messages WHERE status = 'failed')::text AS failed_messages,
           (SELECT COUNT(*) FROM abandoned_cart_messages
             WHERE deleted_at IS NULL AND status = 'pending' AND scheduled_for <= now())::text
             AS due_pending,
           (SELECT COUNT(*) FROM recovered_from_sent)::text AS recovered_from_sent_messages,
           (SELECT COUNT(*) FROM window_messages WHERE skip_reason = 'shopify_order_found')::text AS shopify_blocks,
           (SELECT COUNT(*) FROM window_messages WHERE skip_reason = 'opt_out')::text AS optout_blocks,
           (SELECT COUNT(*) FROM window_messages WHERE skip_reason = 'klaviyo_email_found')::text AS klaviyo_blocks`,
        [from.toISOString(), to.toISOString()],
      ),
      db.raw<ByTypeRow>(
        `WITH typed AS (
           SELECT unnest($3::text[]) AS message_type
         ),
         window_messages AS (
           SELECT *
             FROM abandoned_cart_messages
            WHERE deleted_at IS NULL
              AND COALESCE(sent_at, updated_at, scheduled_for) >= $1::timestamptz
              AND COALESCE(sent_at, updated_at, scheduled_for) < $2::timestamptz
         )
         SELECT t.message_type,
                COUNT(m.id) FILTER (WHERE m.status = 'sent')::text AS sent,
                COUNT(m.id) FILTER (WHERE m.status = 'skipped')::text AS skipped,
                COUNT(m.id) FILTER (WHERE m.status = 'pending')::text AS pending,
                COUNT(m.id) FILTER (WHERE m.status = 'failed')::text AS failed,
                COUNT(c.id) FILTER (WHERE c.recovered_source_message_id = m.id)::text AS recovered,
                COALESCE(SUM(c.recovered_amount) FILTER (WHERE c.recovered_source_message_id = m.id), 0)::text
                  AS recovered_revenue
           FROM typed t
           LEFT JOIN window_messages m ON m.message_type = t.message_type
           LEFT JOIN abandoned_cart_cases c ON c.recovered_source_message_id = m.id AND c.deleted_at IS NULL
          GROUP BY t.message_type
          ORDER BY array_position($3::text[], t.message_type)`,
        [from.toISOString(), to.toISOString(), MESSAGE_TYPES],
      ),
      db.raw<{ skip_reason: string; count: string }>(
        `SELECT COALESCE(skip_reason, 'unknown') AS skip_reason, COUNT(*)::text AS count
           FROM abandoned_cart_messages
          WHERE deleted_at IS NULL
            AND status = 'skipped'
            AND COALESCE(sent_at, updated_at, scheduled_for) >= $1::timestamptz
            AND COALESCE(sent_at, updated_at, scheduled_for) < $2::timestamptz
          GROUP BY COALESCE(skip_reason, 'unknown')
          ORDER BY COUNT(*) DESC
          LIMIT 20`,
        [from.toISOString(), to.toISOString()],
      ),
      db.raw<{ date: string; cases_opened: string }>(
        `SELECT to_char(opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date, COUNT(*)::text AS cases_opened
           FROM abandoned_cart_cases
          WHERE deleted_at IS NULL
            AND opened_at >= $1::timestamptz
            AND opened_at < $2::timestamptz
          GROUP BY 1`,
        [from.toISOString(), to.toISOString()],
      ),
      db.raw<MessageDayRow>(
        `SELECT to_char(COALESCE(sent_at, updated_at, scheduled_for) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
                COUNT(*) FILTER (WHERE status = 'sent')::text AS sent,
                COUNT(*) FILTER (WHERE status = 'skipped')::text AS skipped,
                COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
                COUNT(*) FILTER (WHERE status = 'sent' AND message_type = 'abandoned_cart_1')::text AS abandoned_cart_1,
                COUNT(*) FILTER (WHERE status = 'sent' AND message_type = 'abandoned_cart_2')::text AS abandoned_cart_2,
                COUNT(*) FILTER (WHERE status = 'sent' AND message_type = 'abandoned_cart_3')::text AS abandoned_cart_3,
                COUNT(*) FILTER (WHERE status = 'sent' AND message_type = 'payment_help_1')::text AS payment_help_1
           FROM abandoned_cart_messages
          WHERE deleted_at IS NULL
            AND COALESCE(sent_at, updated_at, scheduled_for) >= $1::timestamptz
            AND COALESCE(sent_at, updated_at, scheduled_for) < $2::timestamptz
          GROUP BY 1`,
        [from.toISOString(), to.toISOString()],
      ),
      db.raw<{ date: string; recovered: string; recovered_revenue: string }>(
        `SELECT to_char(recovered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
                COUNT(*)::text AS recovered,
                COALESCE(SUM(recovered_amount), 0)::text AS recovered_revenue
           FROM abandoned_cart_cases
          WHERE deleted_at IS NULL
            AND recovered_at >= $1::timestamptz
            AND recovered_at < $2::timestamptz
          GROUP BY 1`,
        [from.toISOString(), to.toISOString()],
      ),
    ])

    const kpis = kpiRows[0] ?? emptyKpis()
    const sentMessages = num(kpis.sent_messages)
    const recoveredFromSentMessages = num(kpis.recovered_from_sent_messages)
    return {
      meta: {
        range: { from: from.toISOString(), to: to.toISOString() },
        generated_at: new Date().toISOString(),
      },
      kpis: {
        cases_opened: num(kpis.cases_opened),
        open_cases_total: num(kpis.open_cases_total),
        recovered_cases: num(kpis.recovered_cases),
        sent_messages: sentMessages,
        skipped_messages: num(kpis.skipped_messages),
        failed_messages: num(kpis.failed_messages),
        due_pending: num(kpis.due_pending),
        recovered_from_sent_messages: recoveredFromSentMessages,
        recovery_rate: rate(recoveredFromSentMessages, sentMessages),
        recovered_revenue: money(kpis.recovered_revenue),
        shopify_blocks: num(kpis.shopify_blocks),
        optout_blocks: num(kpis.optout_blocks),
        klaviyo_blocks: num(kpis.klaviyo_blocks),
      },
      by_type: byTypeRows.map((row) => {
        const sent = num(row.sent)
        const recovered = num(row.recovered)
        return {
          message_type: row.message_type,
          sent,
          skipped: num(row.skipped),
          pending: num(row.pending),
          failed: num(row.failed),
          recovered,
          recovery_rate: rate(recovered, sent),
          recovered_revenue: money(row.recovered_revenue),
        }
      }),
      skip_reasons: skipRows.map((row) => ({ skip_reason: row.skip_reason, count: num(row.count) })),
      daily: buildDaily(from, to, caseDayRows, messageDayRows, recoveredDayRows),
    }
  },
})

interface KpiRow {
  cases_opened: string
  open_cases_total: string
  recovered_cases: string
  recovered_revenue: string
  sent_messages: string
  skipped_messages: string
  failed_messages: string
  due_pending: string
  recovered_from_sent_messages: string
  shopify_blocks: string
  optout_blocks: string
  klaviyo_blocks: string
}

interface ByTypeRow {
  message_type: string
  sent: string
  skipped: string
  pending: string
  failed: string
  recovered: string
  recovered_revenue: string
}

interface MessageDayRow {
  date: string
  sent: string
  skipped: string
  failed: string
  abandoned_cart_1: string
  abandoned_cart_2: string
  abandoned_cart_3: string
  payment_help_1: string
}

function buildDaily(
  from: Date,
  to: Date,
  caseRows: Array<{ date: string; cases_opened: string }>,
  messageRows: MessageDayRow[],
  recoveredRows: Array<{ date: string; recovered: string; recovered_revenue: string }>,
) {
  const casesByDate = new Map(caseRows.map((row) => [row.date, row]))
  const messagesByDate = new Map(messageRows.map((row) => [row.date, row]))
  const recoveredByDate = new Map(recoveredRows.map((row) => [row.date, row]))
  return buildDays(from, to).map((date) => {
    const cases = casesByDate.get(date)
    const messages = messagesByDate.get(date)
    const recovered = recoveredByDate.get(date)
    return {
      date,
      cases_opened: num(cases?.cases_opened),
      sent: num(messages?.sent),
      skipped: num(messages?.skipped),
      failed: num(messages?.failed),
      recovered: num(recovered?.recovered),
      recovered_revenue: money(recovered?.recovered_revenue),
      abandoned_cart_1: num(messages?.abandoned_cart_1),
      abandoned_cart_2: num(messages?.abandoned_cart_2),
      abandoned_cart_3: num(messages?.abandoned_cart_3),
      payment_help_1: num(messages?.payment_help_1),
    }
  })
}

function buildDays(from: Date, to: Date): string[] {
  const out: string[] = []
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()))
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

function emptyKpis(): KpiRow {
  return {
    cases_opened: '0',
    open_cases_total: '0',
    recovered_cases: '0',
    recovered_revenue: '0',
    sent_messages: '0',
    skipped_messages: '0',
    failed_messages: '0',
    due_pending: '0',
    recovered_from_sent_messages: '0',
    shopify_blocks: '0',
    optout_blocks: '0',
    klaviyo_blocks: '0',
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
