type MessageType = 'abandoned_cart_1' | 'abandoned_cart_2' | 'abandoned_cart_3' | 'payment_help_1' | 'klaviyo_abandoned'
type MessageStatus = 'pending' | 'sent' | 'skipped' | 'failed'

interface CaseRow {
  id: string
  cart_id: string
  email: string
  case_type: string
  status: string
  stage_at_open: string | null
  last_cart_action_at: Date | string
  opened_at: Date | string
  recovered_at: Date | string | null
  recovered_order_id: string | null
  recovered_amount: number | string | null
  recovered_source_message_id: string | null
}

interface MessageRow {
  id: string
  case_id: string
  cart_id: string
  email: string
  message_type: MessageType
  status: MessageStatus
  scheduled_for: Date | string
  sent_at: Date | string | null
  provider: string | null
  provider_message_id: string | null
  template_key: string | null
  locale: string | null
  subject: string | null
  snapshot_html_url: string | null
  snapshot_error: string | null
  skip_reason: string | null
  error_message: string | null
  created_at: Date | string | null
  updated_at: Date | string | null
}

interface CheckRow {
  id: string
  case_id: string
  message_id: string | null
  check_type: string
  status: string
  raw_summary: string | null
  checked_at: Date | string
}

interface GraphQuery {
  graph(input: unknown): Promise<unknown>
}

const MESSAGE_TYPES: MessageType[] = ['abandoned_cart_1', 'abandoned_cart_2', 'abandoned_cart_3', 'payment_help_1']

export default defineQuery({
  name: 'abandoned-cart-campaign-dashboard',
  description: 'Full abandoned-cart campaign dashboard: stats, daily windows, cases, messages, and guard checks.',
  input: z.object({
    from: z.string(),
    to: z.string(),
    limit: z.number().int().positive().max(1000).default(250),
  }),
  handler: async (input, { query }) => {
    const from = new Date(input.from)
    const to = new Date(input.to)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      throw new MantaError(
        'INVALID_DATA',
        `abandoned-cart-campaign-dashboard: invalid range from=${input.from} to=${input.to}`,
      )
    }

    const q = query as GraphQuery
    const [cases, messages, checks] = await Promise.all([
      pullAll<CaseRow>(
        (pagination) =>
          q.graph({
            entity: 'abandonedCartCase',
            fields: [
              'id',
              'cart_id',
              'email',
              'case_type',
              'status',
              'stage_at_open',
              'last_cart_action_at',
              'opened_at',
              'recovered_at',
              'recovered_order_id',
              'recovered_amount',
              'recovered_source_message_id',
            ],
            pagination,
          }) as Promise<CaseRow[]>,
      ),
      pullAll<MessageRow>(
        (pagination) =>
          q.graph({
            entity: 'abandonedCartMessage',
            fields: [
              'id',
              'case_id',
              'cart_id',
              'email',
              'message_type',
              'status',
              'scheduled_for',
              'sent_at',
              'provider',
              'provider_message_id',
              'template_key',
              'locale',
              'subject',
              'snapshot_html_url',
              'snapshot_error',
              'skip_reason',
              'error_message',
              'created_at',
              'updated_at',
            ],
            pagination,
          }) as Promise<MessageRow[]>,
      ),
      pullAll<CheckRow>(
        (pagination) =>
          q.graph({
            entity: 'abandonedCartCheck',
            fields: ['id', 'case_id', 'message_id', 'check_type', 'status', 'raw_summary', 'checked_at'],
            filters: { checked_at: { $gte: from.toISOString(), $lt: to.toISOString() } },
            pagination,
          }) as Promise<CheckRow[]>,
      ),
    ])

    const casesById = new Map(cases.map((row) => [row.id, row]))
    const messagesById = new Map(messages.map((row) => [row.id, row]))
    const messagesByCase = groupBy(messages, (row) => row.case_id)
    const recoveredMessageIds = new Set(cases.map((row) => row.recovered_source_message_id).filter(Boolean) as string[])

    const openedCases = cases.filter((row) => inRange(row.opened_at, from, to))
    const recoveredCases = cases.filter((row) => row.recovered_at && inRange(row.recovered_at, from, to))
    const windowMessages = messages.filter((row) => {
      const at = row.sent_at ?? row.updated_at ?? row.scheduled_for
      return inRange(at, from, to)
    })

    const byType = MESSAGE_TYPES.map((type) => {
      const rows = windowMessages.filter((row) => row.message_type === type)
      const sent = rows.filter((row) => row.status === 'sent')
      const recovered = sent.filter((row) => recoveredMessageIds.has(row.id))
      const revenue = recovered.reduce((sum, row) => sum + money(casesById.get(row.case_id)?.recovered_amount), 0)
      return {
        message_type: type,
        sent: sent.length,
        skipped: rows.filter((row) => row.status === 'skipped').length,
        pending: rows.filter((row) => row.status === 'pending').length,
        failed: rows.filter((row) => row.status === 'failed').length,
        recovered: recovered.length,
        recovery_rate: rate(recovered.length, sent.length),
        recovered_revenue: roundMoney(revenue),
      }
    })

    const skipReasons = Array.from(
      groupBy(
        windowMessages.filter((row) => row.status === 'skipped'),
        (row) => row.skip_reason ?? 'unknown',
      ),
    )
      .map(([skip_reason, rows]) => ({ skip_reason, count: rows.length }))
      .sort((a, b) => b.count - a.count)

    const daily = buildDays(from, to).map((day) => {
      const dayMessages = windowMessages.filter(
        (row) => dayKey(row.sent_at ?? row.updated_at ?? row.scheduled_for) === day,
      )
      const dayRecovered = recoveredCases.filter((row) => dayKey(row.recovered_at) === day)
      return {
        date: day,
        cases_opened: openedCases.filter((row) => dayKey(row.opened_at) === day).length,
        sent: dayMessages.filter((row) => row.status === 'sent').length,
        skipped: dayMessages.filter((row) => row.status === 'skipped').length,
        failed: dayMessages.filter((row) => row.status === 'failed').length,
        recovered: dayRecovered.length,
        recovered_revenue: roundMoney(dayRecovered.reduce((sum, row) => sum + money(row.recovered_amount), 0)),
        abandoned_cart_1: dayMessages.filter((row) => row.status === 'sent' && row.message_type === 'abandoned_cart_1')
          .length,
        abandoned_cart_2: dayMessages.filter((row) => row.status === 'sent' && row.message_type === 'abandoned_cart_2')
          .length,
        abandoned_cart_3: dayMessages.filter((row) => row.status === 'sent' && row.message_type === 'abandoned_cart_3')
          .length,
        payment_help_1: dayMessages.filter((row) => row.status === 'sent' && row.message_type === 'payment_help_1')
          .length,
      }
    })

    const caseItems = cases
      .filter(
        (row) =>
          inRange(row.opened_at, from, to) || messagesByCase.get(row.id)?.some((m) => windowMessages.includes(m)),
      )
      .map((row) => enrichCase(row, messagesByCase.get(row.id) ?? [], checks, recoveredMessageIds))
      .sort((a, b) => timeValue(b.last_activity_at) - timeValue(a.last_activity_at))
      .slice(0, input.limit)

    const messageItems = windowMessages
      .map((row) => enrichMessage(row, casesById.get(row.case_id), recoveredMessageIds))
      .sort((a, b) => timeValue(b.activity_at) - timeValue(a.activity_at))
      .slice(0, input.limit)

    const checkItems = checks
      .map((row) =>
        enrichCheck(row, casesById.get(row.case_id), row.message_id ? messagesById.get(row.message_id) : null),
      )
      .sort((a, b) => timeValue(b.checked_at) - timeValue(a.checked_at))
      .slice(0, input.limit)

    const sentMessages = windowMessages.filter((row) => row.status === 'sent')
    const recoveredFromWindowMessages = sentMessages.filter((row) => recoveredMessageIds.has(row.id))
    return {
      meta: {
        range: { from: from.toISOString(), to: to.toISOString() },
        generated_at: new Date().toISOString(),
      },
      kpis: {
        cases_opened: openedCases.length,
        open_cases_total: cases.filter((row) => row.status === 'open').length,
        recovered_cases: recoveredCases.length,
        sent_messages: sentMessages.length,
        skipped_messages: windowMessages.filter((row) => row.status === 'skipped').length,
        failed_messages: windowMessages.filter((row) => row.status === 'failed').length,
        due_pending: messages.filter((row) => row.status === 'pending' && timeValue(row.scheduled_for) <= Date.now())
          .length,
        recovered_from_sent_messages: recoveredFromWindowMessages.length,
        recovery_rate: rate(recoveredFromWindowMessages.length, sentMessages.length),
        recovered_revenue: roundMoney(recoveredCases.reduce((sum, row) => sum + money(row.recovered_amount), 0)),
        shopify_blocks: windowMessages.filter((row) => row.skip_reason === 'shopify_order_found').length,
        optout_blocks: windowMessages.filter((row) => row.skip_reason === 'opt_out').length,
        klaviyo_blocks: windowMessages.filter((row) => row.skip_reason === 'klaviyo_email_found').length,
      },
      by_type: byType,
      skip_reasons: skipReasons,
      daily,
      cases: caseItems,
      messages: messageItems,
      checks: checkItems,
    }
  },
})

function enrichCase(row: CaseRow, messages: MessageRow[], checks: CheckRow[], recoveredMessageIds: Set<string>) {
  const sent = messages.filter((message) => message.status === 'sent')
  const lastSent = newest(sent.map((message) => message.sent_at).filter(Boolean) as Array<Date | string>)
  const pending = messages
    .filter((message) => message.status === 'pending')
    .sort((a, b) => timeValue(a.scheduled_for) - timeValue(b.scheduled_for))[0]
  const latestActivity = newest(
    [row.opened_at, row.last_cart_action_at, lastSent, row.recovered_at].filter(Boolean) as Array<Date | string>,
  )
  return {
    id: row.id,
    cart_id: row.cart_id,
    email: row.email,
    case_type: row.case_type,
    status: row.status,
    stage_at_open: row.stage_at_open,
    opened_at: iso(row.opened_at),
    last_cart_action_at: iso(row.last_cart_action_at),
    last_activity_at: latestActivity ? iso(latestActivity) : iso(row.opened_at),
    email_1: messageLabel(messages, 'abandoned_cart_1'),
    email_2: messageLabel(messages, 'abandoned_cart_2'),
    email_3: messageLabel(messages, 'abandoned_cart_3'),
    payment_help: messageLabel(messages, 'payment_help_1'),
    messages_sent: sent.length,
    last_sent_at: lastSent ? iso(lastSent) : null,
    next_due_at: pending ? iso(pending.scheduled_for) : null,
    recovered_at: row.recovered_at ? iso(row.recovered_at) : null,
    recovered_amount: money(row.recovered_amount),
    recovered_by_message_type: messages.find((message) => recoveredMessageIds.has(message.id))?.message_type ?? null,
    checks_blocked: checks.filter((check) => check.case_id === row.id && check.status === 'blocked').length,
    checks_error: checks.filter((check) => check.case_id === row.id && check.status === 'error').length,
  }
}

function enrichMessage(row: MessageRow, cartCase: CaseRow | undefined, recoveredMessageIds: Set<string>) {
  const activityAt = row.sent_at ?? row.updated_at ?? row.scheduled_for
  return {
    id: row.id,
    case_id: row.case_id,
    cart_id: row.cart_id,
    email: row.email,
    case_type: cartCase?.case_type ?? null,
    stage_at_open: cartCase?.stage_at_open ?? null,
    message_type: row.message_type,
    status: row.status,
    scheduled_for: iso(row.scheduled_for),
    sent_at: row.sent_at ? iso(row.sent_at) : null,
    activity_at: iso(activityAt),
    provider: row.provider,
    provider_message_id: row.provider_message_id,
    locale: row.locale,
    subject: row.subject,
    snapshot_html_url: row.snapshot_html_url,
    snapshot_error: row.snapshot_error,
    skip_reason: row.skip_reason,
    error_message: row.error_message,
    recovered: recoveredMessageIds.has(row.id),
    recovered_amount: recoveredMessageIds.has(row.id) ? money(cartCase?.recovered_amount) : 0,
  }
}

function enrichCheck(row: CheckRow, cartCase: CaseRow | undefined, message: MessageRow | null | undefined) {
  return {
    id: row.id,
    case_id: row.case_id,
    message_id: row.message_id,
    email: cartCase?.email ?? message?.email ?? null,
    case_type: cartCase?.case_type ?? null,
    message_type: message?.message_type ?? null,
    check_type: row.check_type,
    status: row.status,
    checked_at: iso(row.checked_at),
    raw_summary: row.raw_summary,
  }
}

function messageLabel(messages: MessageRow[], type: MessageType): string | null {
  const message = messages.find((row) => row.message_type === type)
  if (!message) return null
  if (message.status === 'skipped') return message.skip_reason ? `skipped:${message.skip_reason}` : 'skipped'
  return message.status
}

async function pullAll<T>(fetchPage: (pagination: { limit: number; offset: number }) => Promise<T[]>): Promise<T[]> {
  const limit = 1000
  const out: T[] = []
  for (let offset = 0; offset < 50000; offset += limit) {
    const page = await fetchPage({ limit, offset })
    out.push(...page)
    if (page.length < limit) break
  }
  return out
}

function groupBy<T>(rows: T[], keyFn: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyFn(row)
    const list = out.get(key) ?? []
    list.push(row)
    out.set(key, list)
  }
  return out
}

function buildDays(from: Date, to: Date): string[] {
  const out: string[] = []
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()))
  while (cursor <= end) {
    out.push(dayKey(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

function inRange(value: Date | string | null | undefined, from: Date, to: Date): boolean {
  const time = timeValue(value)
  return Number.isFinite(time) && time >= from.getTime() && time < to.getTime()
}

function timeValue(value: Date | string | null | undefined): number {
  if (!value) return 0
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

function newest(values: Array<Date | string>): Date | string | null {
  let latest: Date | string | null = null
  for (const value of values) {
    if (!latest || timeValue(value) > timeValue(latest)) latest = value
  }
  return latest
}

function dayKey(value: Date | string | null | undefined): string {
  if (!value) return ''
  return new Date(value).toISOString().slice(0, 10)
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function money(value: number | string | null | undefined): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0
  return Number.isFinite(n) ? n : 0
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function rate(num: number, den: number): number {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : 0
}
