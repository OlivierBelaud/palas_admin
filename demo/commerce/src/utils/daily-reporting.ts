import type { RuntimeNotificationPort, RuntimeSql } from './manta-runtime'

export const DAILY_REPORT_TIMEZONE = 'Europe/Paris'
export const DEFAULT_DAILY_REPORT_RECIPIENTS = [
  'lore@fancypalas.com',
  'lea@fancypalas.com',
  'olivierbelaudpro@gmail.com',
]

type SegmentKey = 'unknown' | 'known_no_purchase' | 'returning_customer' | 'unattributed' | 'total'

interface MetricRow {
  sessions: number
  unique_visitors: number
  orders: number
  revenue: number
}

export interface DailyReportSegmentRow extends MetricRow {
  segment: SegmentKey
  label: string
  average_order_value: number | null
  session_conversion_rate: number | null
  visitor_conversion_rate: number | null
}

export interface DailyReportCountryRow {
  country_code: string
  country_name: string
  orders: number
  revenue: number
}

export interface DailyReportSourceRow extends MetricRow {
  source: string
  session_share: number
}

export interface DailyReportChannelSegmentRow extends MetricRow {
  segment: SegmentKey | 'total'
  segment_label: string
  channel: string
}

export interface DailyReportPayload {
  day: string
  timezone: string
  generated_at: string
  period: {
    start_utc: string
    end_utc: string
  }
  summary: {
    sessions: number
    unique_visitors: number
    orders: number
    revenue: number
    average_order_value: number | null
    session_conversion_rate: number | null
    visitor_conversion_rate: number | null
    sold_countries_count: number
    unattributed_orders: number
    unattributed_revenue: number
    source_max_last_event_at: string | null
  }
  segments: DailyReportSegmentRow[]
  countries: DailyReportCountryRow[]
  sources: DailyReportSourceRow[]
  channel_segments: DailyReportChannelSegmentRow[]
}

interface SendDailyReportResult {
  payload: DailyReportPayload
  snapshot_status: 'ready' | 'partial' | 'failed'
  sent: Array<{ to: string; status: 'SUCCESS' | 'FAILURE' | 'PENDING'; id?: string; error?: string }>
}

interface SendDailyReportOptions {
  sql: RuntimeSql
  notification: RuntimeNotificationPort
  day?: string
  now?: Date
  recipients?: string[]
  fromEmail?: string
  replyTo?: string
  dryRun?: boolean
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

const SEGMENT_LABELS: Record<SegmentKey, string> = {
  unknown: 'Inconnus',
  known_no_purchase: 'Prospects',
  returning_customer: 'Clients',
  unattributed: 'Non attribue',
  total: 'Total journee',
}

const SOURCE_CASE = `
CASE
  WHEN COALESCE(first_url, '') ILIKE '%palas_email_type=abandoned_cart%'
    OR COALESCE(utm_source, '') ILIKE 'palas_crm'
    OR COALESCE(utm_campaign, '') ILIKE '%abandoned%cart%'
    OR COALESCE(first_url, '') ILIKE '%cart_link_id=%'
    THEN 'Email relance panier / lifecycle'
  WHEN COALESCE(utm_source, '') ILIKE '%klaviyo%'
    OR COALESCE(utm_medium, '') ILIKE '%email%'
    OR COALESCE(first_url, '') ILIKE '%_kx=%'
    THEN 'Newsletter / Klaviyo email'
  WHEN COALESCE(utm_source, '') ILIKE '%google%'
    OR COALESCE(utm_source, '') ILIKE '%adwords%'
    OR COALESCE(first_url, '') ILIKE '%gclid=%'
    THEN 'Google Ads'
  WHEN COALESCE(utm_source, '') ILIKE '%instagram%'
    OR COALESCE(referring_domain, '') ILIKE '%instagram%'
    THEN 'Meta Ads - Instagram'
  WHEN COALESCE(utm_source, '') ILIKE '%facebook%'
    OR COALESCE(referring_domain, '') ILIKE '%facebook%'
    THEN 'Meta Ads - Facebook'
  WHEN COALESCE(utm_source, '') ILIKE '%meta%'
    OR COALESCE(first_url, '') ILIKE '%fbclid=%'
    THEN 'Meta Ads - unknown'
  WHEN COALESCE(utm_source, '') ILIKE '%tiktok%'
    OR COALESCE(referring_domain, '') ILIKE '%tiktok%'
    OR COALESCE(first_url, '') ILIKE '%ttclid=%'
    THEN 'TikTok Ads'
  WHEN COALESCE(utm_source, '') ILIKE '%pinterest%'
    OR COALESCE(referring_domain, '') ILIKE '%pinterest%'
    OR COALESCE(first_url, '') ILIKE '%epik=%'
    THEN 'Pinterest Ads'
  WHEN is_paid_session = true
    THEN 'Paid media - unknown'
  ELSE 'Autres sources'
END`

const OPERATIONAL_CHANNEL_CASE = `
CASE
  WHEN source_label IN ('Google Ads', 'Meta Ads - Instagram', 'Meta Ads - Facebook', 'Meta Ads - unknown', 'TikTok Ads', 'Pinterest Ads', 'Paid media - unknown')
    THEN 'Paid media'
  WHEN source_label = 'Newsletter / Klaviyo email'
    THEN 'Newsletter / Klaviyo email'
  WHEN source_label = 'Email relance panier / lifecycle'
    THEN 'Email relance panier / lifecycle'
  ELSE 'Autres sources'
END`

export function dailyReportRecipientsFromEnv(value = process.env.PALAS_DAILY_REPORT_RECIPIENTS): string[] {
  const recipients = value
    ?.split(',')
    .map((email) => email.trim())
    .filter(Boolean)
  return recipients && recipients.length > 0 ? recipients : DEFAULT_DAILY_REPORT_RECIPIENTS
}

export function previousParisDay(now = new Date()): string {
  const parts = datePartsInTimeZone(now, DAILY_REPORT_TIMEZONE)
  const localMidday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - 1, 12))
  return isoDay(localMidday)
}

export function parisDayWindow(day: string): { start: Date; end: Date } {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) throw new MantaError('INVALID_DATA', `Invalid reporting day: ${day}`)
  return {
    start: zonedDateTimeToUtc(DAILY_REPORT_TIMEZONE, year, month, date, 0, 0, 0),
    end: zonedDateTimeToUtc(DAILY_REPORT_TIMEZONE, year, month, date + 1, 0, 0, 0),
  }
}

export async function buildDailyReportPayload(
  sql: RuntimeSql,
  options: { day?: string; now?: Date } = {},
): Promise<DailyReportPayload> {
  const day = options.day ?? previousParisDay(options.now)
  const { start, end } = parisDayWindow(day)
  const startIso = start.toISOString()
  const endIso = end.toISOString()

  const [base] = await sql.unsafe<BaseRow[]>(
    `
    SELECT
      COUNT(*)::int AS sessions,
      COUNT(DISTINCT distinct_id)::int AS unique_visitors,
      MAX(last_event_at) AS source_max_last_event_at
    FROM visitor_sessions
    WHERE deleted_at IS NULL
      AND started_at >= $1::timestamptz
      AND started_at < $2::timestamptz
    `,
    [startIso, endIso],
  )

  const [orderSummary] = await sql.unsafe<OrderSummaryRow[]>(
    `
    SELECT
      COUNT(*)::int AS orders,
      COALESCE(SUM(total_price), 0)::float AS revenue,
      COUNT(DISTINCT NULLIF(shipping_country_code, ''))::int AS sold_countries_count
    FROM orders
    WHERE deleted_at IS NULL
      AND include_in_ecommerce_analytics = true
      AND status IN ('paid', 'fulfilled')
      AND placed_at >= $1::timestamptz
      AND placed_at < $2::timestamptz
    `,
    [startIso, endIso],
  )

  const rawSegmentRows = await sql.unsafe<SegmentAggRow[]>(segmentAggSql(), [startIso, endIso])
  const rawSourceRows = await sql.unsafe<SourceAggRow[]>(sourceAggSql(), [startIso, endIso])
  const rawChannelRows = await sql.unsafe<ChannelAggRow[]>(channelAggSql(), [startIso, endIso])
  const countryRows = await sql.unsafe<CountryRow[]>(
    `
    SELECT
      COALESCE(NULLIF(shipping_country_code, ''), 'UN') AS country_code,
      COALESCE(NULLIF(shipping_country_name, ''), NULLIF(shipping_country_code, ''), 'Non renseigne') AS country_name,
      COUNT(*)::int AS orders,
      COALESCE(SUM(total_price), 0)::float AS revenue
    FROM orders
    WHERE deleted_at IS NULL
      AND include_in_ecommerce_analytics = true
      AND status IN ('paid', 'fulfilled')
      AND placed_at >= $1::timestamptz
      AND placed_at < $2::timestamptz
    GROUP BY 1, 2
    ORDER BY orders DESC, revenue DESC, country_name ASC
    `,
    [startIso, endIso],
  )

  const summary = {
    sessions: toNumber(base?.sessions),
    unique_visitors: toNumber(base?.unique_visitors),
    orders: toNumber(orderSummary?.orders),
    revenue: roundMoney(toNumber(orderSummary?.revenue)),
    sold_countries_count: toNumber(orderSummary?.sold_countries_count),
    source_max_last_event_at: base?.source_max_last_event_at
      ? new Date(base.source_max_last_event_at).toISOString()
      : null,
  }

  const segmentRows = buildSegmentRows(rawSegmentRows, summary)
  const unattributed = segmentRows.find((row) => row.segment === 'unattributed')

  return {
    day,
    timezone: DAILY_REPORT_TIMEZONE,
    generated_at: (options.now ?? new Date()).toISOString(),
    period: { start_utc: startIso, end_utc: endIso },
    summary: {
      ...summary,
      average_order_value: ratio(summary.revenue, summary.orders),
      session_conversion_rate: ratio(summary.orders, summary.sessions),
      visitor_conversion_rate: ratio(summary.orders, summary.unique_visitors),
      unattributed_orders: unattributed?.orders ?? 0,
      unattributed_revenue: unattributed?.revenue ?? 0,
    },
    segments: segmentRows,
    countries: countryRows.map((row) => ({
      country_code: row.country_code,
      country_name: row.country_name,
      orders: toNumber(row.orders),
      revenue: roundMoney(toNumber(row.revenue)),
    })),
    sources: rawSourceRows.map((row) => ({
      source: row.source_label,
      sessions: toNumber(row.sessions),
      session_share: ratio(toNumber(row.sessions), summary.sessions) ?? 0,
      unique_visitors: toNumber(row.unique_visitors),
      orders: toNumber(row.orders),
      revenue: roundMoney(toNumber(row.revenue)),
    })),
    channel_segments: rawChannelRows.map((row) => ({
      segment: row.segment as SegmentKey | 'total',
      segment_label: row.segment === 'total' ? SEGMENT_LABELS.total : SEGMENT_LABELS[row.segment as SegmentKey],
      channel: row.operational_channel,
      sessions: toNumber(row.sessions),
      unique_visitors: toNumber(row.unique_visitors),
      orders: toNumber(row.orders),
      revenue: roundMoney(toNumber(row.revenue)),
    })),
  }
}

export async function storeDailyReportSnapshot(
  sql: RuntimeSql,
  payload: DailyReportPayload,
  status: 'ready' | 'partial' | 'failed' = 'ready',
  errorMessage: string | null = null,
): Promise<void> {
  await sql.unsafe(
    `
    INSERT INTO reporting_daily_snapshots
      (day, timezone, status, payload, generated_at, source_max_last_event_at, error_message, updated_at)
    VALUES
      ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::timestamptz, $7, NOW())
    ON CONFLICT (day, timezone) WHERE deleted_at IS NULL
    DO UPDATE SET
      status = EXCLUDED.status,
      payload = EXCLUDED.payload,
      generated_at = EXCLUDED.generated_at,
      source_max_last_event_at = EXCLUDED.source_max_last_event_at,
      error_message = EXCLUDED.error_message,
      updated_at = NOW()
    `,
    [
      payload.day,
      payload.timezone,
      status,
      JSON.stringify(payload),
      payload.generated_at,
      payload.summary.source_max_last_event_at,
      errorMessage,
    ],
  )
}

export async function sendDailyReportEmail(options: SendDailyReportOptions): Promise<SendDailyReportResult> {
  const log = options.log ?? console
  const payload = await buildDailyReportPayload(options.sql, { day: options.day, now: options.now })
  const snapshotStatus = payload.summary.sessions > 0 ? 'ready' : 'partial'
  await storeDailyReportSnapshot(options.sql, payload, snapshotStatus)

  const recipients = options.recipients ?? dailyReportRecipientsFromEnv()
  const html = renderDailyReportHtml(payload)
  const text = renderDailyReportText(payload)
  const subject = `Reporting Palas - ${formatLongDay(payload.day)}`
  const sent: SendDailyReportResult['sent'] = []

  if (options.dryRun) {
    return {
      payload,
      snapshot_status: snapshotStatus,
      sent: recipients.map((to) => ({ to, status: 'PENDING' })),
    }
  }

  for (const to of recipients) {
    const result = await options.notification.send({
      to,
      channel: 'email',
      from: options.fromEmail ?? process.env.RESEND_FROM_EMAIL ?? 'PALAS <hello@fancypalas.com>',
      replyTo: options.replyTo ?? process.env.RESEND_REPLY_TO,
      subject,
      html,
      text,
      idempotency_key: `daily-report:${payload.day}:${to}`,
      tags: [
        { name: 'kind', value: 'daily_reporting' },
        { name: 'day', value: payload.day },
      ],
    })
    sent.push({
      to,
      status: result.status,
      id: result.id,
      error: result.error?.message,
    })
    if (result.status === 'FAILURE') {
      log.error(`[daily-reporting] send failed to=${to} error=${result.error?.message ?? 'unknown'}`)
    }
  }

  return { payload, snapshot_status: snapshotStatus, sent }
}

export function renderDailyReportHtml(payload: DailyReportPayload): string {
  const css = `
    body{margin:0;background:#f5f3ee;color:#161412;font-family:Inter,Arial,sans-serif}
    .wrap{max-width:760px;margin:0 auto;padding:28px 18px}
    .panel{background:#fff;border:1px solid #ded8cf;border-radius:8px;overflow:hidden}
    .head{padding:26px 28px;border-bottom:1px solid #ebe6df}
    .eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#706a60;margin:0 0 8px}
    h1{font-size:24px;line-height:1.2;margin:0;color:#161412}
    h2{font-size:17px;margin:28px 0 10px;color:#161412}
    .content{padding:0 28px 28px}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:22px 0}
    .kpi{border:1px solid #ebe6df;border-radius:7px;padding:12px}
    .kpi .label{font-size:12px;color:#706a60}
    .kpi .value{font-size:19px;font-weight:650;margin-top:4px}
    table{border-collapse:collapse;width:100%;font-size:13px}
    th,td{padding:9px 8px;border-bottom:1px solid #eee8df;text-align:right;vertical-align:top}
    th:first-child,td:first-child{text-align:left}
    th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#706a60;background:#faf8f4}
    .note{font-size:13px;line-height:1.45;color:#4c463f}
    .muted{color:#706a60}
    @media(max-width:620px){.kpis{grid-template-columns:repeat(2,1fr)}.content,.head{padding-left:18px;padding-right:18px}table{font-size:12px}}
  `
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style></head>
<body>
  <div class="wrap">
    <div class="panel">
      <div class="head">
        <p class="eyebrow">Reporting quotidien Palas</p>
        <h1>${escapeHtml(formatLongDay(payload.day))}</h1>
        <p class="note muted">Journee Europe/Paris, ${formatTimeRange(payload)}. Genere le ${formatDateTime(payload.generated_at)}.</p>
      </div>
      <div class="content">
        <div class="kpis">
          ${kpi('Sessions', formatInteger(payload.summary.sessions))}
          ${kpi('Visiteurs', formatInteger(payload.summary.unique_visitors))}
          ${kpi('Commandes', formatInteger(payload.summary.orders))}
          ${kpi('CA', formatMoney(payload.summary.revenue))}
          ${kpi('Panier moyen', formatNullableMoney(payload.summary.average_order_value))}
          ${kpi('Conv. visiteurs', formatPercent(payload.summary.visitor_conversion_rate))}
          ${kpi('Pays vendus', formatInteger(payload.summary.sold_countries_count))}
          ${kpi('Non attribue', `${payload.summary.unattributed_orders} cmd`)}
        </div>
        ${renderSegmentTable(payload)}
        ${renderCountryTable(payload)}
        ${renderSourceTable(payload)}
        ${renderChannelTable(payload)}
        <p class="note muted">Controle qualite : source sessions max ${payload.summary.source_max_last_event_at ? formatDateTime(payload.summary.source_max_last_event_at) : 'non disponible'} ; commandes non attribuees ${payload.summary.unattributed_orders} (${formatMoney(payload.summary.unattributed_revenue)}).</p>
      </div>
    </div>
  </div>
</body>
</html>`
}

export function renderDailyReportText(payload: DailyReportPayload): string {
  const lines = [
    `Reporting Palas - ${formatLongDay(payload.day)}`,
    '',
    `Sessions: ${formatInteger(payload.summary.sessions)}`,
    `Visiteurs uniques: ${formatInteger(payload.summary.unique_visitors)}`,
    `Commandes: ${formatInteger(payload.summary.orders)}`,
    `CA: ${formatMoney(payload.summary.revenue)}`,
    `Panier moyen: ${formatNullableMoney(payload.summary.average_order_value)}`,
    `Conversion visiteurs: ${formatPercent(payload.summary.visitor_conversion_rate)}`,
    `Pays vendus: ${payload.summary.sold_countries_count}`,
    `Non attribue: ${payload.summary.unattributed_orders} commande(s), ${formatMoney(payload.summary.unattributed_revenue)}`,
    '',
    'Segments:',
    ...payload.segments.map(
      (row) =>
        `- ${row.label}: ${row.sessions} sessions, ${row.unique_visitors} visiteurs, ${row.orders} commandes, ${formatMoney(row.revenue)}, conv visiteurs ${formatPercent(row.visitor_conversion_rate)}`,
    ),
    '',
    'Pays:',
    ...payload.countries.map((row) => `- ${row.country_name}: ${row.orders} commandes, ${formatMoney(row.revenue)}`),
    '',
    'Sources:',
    ...payload.sources.map(
      (row) =>
        `- ${row.source}: ${row.sessions} sessions (${formatPercent(row.session_share)}), ${row.unique_visitors} visiteurs, ${row.orders} commandes, ${formatMoney(row.revenue)}`,
    ),
  ]
  return lines.join('\n')
}

function segmentAggSql(): string {
  return `
  WITH ${segmentCte()},
  segment_traffic AS (
    SELECT
      vs.segment,
      COUNT(*)::int AS sessions,
      COUNT(DISTINCT ds.distinct_id)::int AS unique_visitors
    FROM day_sessions ds
    JOIN visitor_segments vs ON vs.distinct_id = ds.distinct_id
    GROUP BY 1
  ),
  attributed_orders AS (
    SELECT DISTINCT ON (o.id)
      o.id AS order_row_id,
      o.total_price,
      vs.segment
    FROM orders o
    JOIN day_sessions ds
      ON ds.order_id = o.shopify_order_id
      OR ds.order_id = o.id::text
    JOIN visitor_segments vs ON vs.distinct_id = ds.distinct_id
    WHERE o.deleted_at IS NULL
      AND o.include_in_ecommerce_analytics = true
      AND o.status IN ('paid', 'fulfilled')
      AND o.placed_at >= $1::timestamptz
      AND o.placed_at < $2::timestamptz
    ORDER BY o.id, ds.last_event_at DESC
  ),
  segment_orders AS (
    SELECT
      segment,
      COUNT(*)::int AS orders,
      COALESCE(SUM(total_price), 0)::float AS revenue
    FROM attributed_orders
    GROUP BY 1
  ),
  unattributed AS (
    SELECT
      'unattributed'::text AS segment,
      0::int AS sessions,
      0::int AS unique_visitors,
      COUNT(*)::int AS orders,
      COALESCE(SUM(o.total_price), 0)::float AS revenue
    FROM orders o
    LEFT JOIN attributed_orders ao ON ao.order_row_id = o.id
    WHERE o.deleted_at IS NULL
      AND o.include_in_ecommerce_analytics = true
      AND o.status IN ('paid', 'fulfilled')
      AND o.placed_at >= $1::timestamptz
      AND o.placed_at < $2::timestamptz
      AND ao.order_row_id IS NULL
  )
  SELECT *
  FROM (
    SELECT st.segment, st.sessions, st.unique_visitors, COALESCE(so.orders, 0)::int AS orders, COALESCE(so.revenue, 0)::float AS revenue
    FROM segment_traffic st
    LEFT JOIN segment_orders so ON so.segment = st.segment
    UNION ALL
    SELECT segment, sessions, unique_visitors, orders, revenue FROM unattributed
  ) rows
  ORDER BY CASE segment WHEN 'unknown' THEN 1 WHEN 'known_no_purchase' THEN 2 WHEN 'returning_customer' THEN 3 ELSE 4 END
  `
}

function sourceAggSql(): string {
  return `
  WITH ${segmentCte()},
  classified_sessions AS (
    SELECT ds.*, ${SOURCE_CASE} AS source_label
    FROM day_sessions ds
  ),
  source_traffic AS (
    SELECT
      source_label,
      COUNT(*)::int AS sessions,
      COUNT(DISTINCT distinct_id)::int AS unique_visitors
    FROM classified_sessions
    GROUP BY 1
  ),
  source_orders AS (
    SELECT
      source_label,
      COUNT(*)::int AS orders,
      COALESCE(SUM(total_price), 0)::float AS revenue
    FROM (
      SELECT DISTINCT ON (o.id)
        o.id,
        o.total_price,
        cs.source_label
      FROM orders o
      JOIN classified_sessions cs
        ON cs.order_id = o.shopify_order_id
        OR cs.order_id = o.id::text
      WHERE o.deleted_at IS NULL
        AND o.include_in_ecommerce_analytics = true
        AND o.status IN ('paid', 'fulfilled')
        AND o.placed_at >= $1::timestamptz
        AND o.placed_at < $2::timestamptz
      ORDER BY o.id, cs.last_event_at DESC
    ) attributed
    GROUP BY 1
  )
  SELECT
    st.source_label,
    st.sessions,
    st.unique_visitors,
    COALESCE(so.orders, 0)::int AS orders,
    COALESCE(so.revenue, 0)::float AS revenue
  FROM source_traffic st
  LEFT JOIN source_orders so ON so.source_label = st.source_label
  ORDER BY st.sessions DESC, st.source_label ASC
  `
}

function channelAggSql(): string {
  return `
  WITH ${segmentCte()},
  classified_sessions AS (
    SELECT ds.*, vs.segment, ${SOURCE_CASE} AS source_label
    FROM day_sessions ds
    JOIN visitor_segments vs ON vs.distinct_id = ds.distinct_id
  ),
  channel_sessions AS (
    SELECT *, ${OPERATIONAL_CHANNEL_CASE} AS operational_channel
    FROM classified_sessions
  ),
  channel_traffic AS (
    SELECT
      segment,
      operational_channel,
      COUNT(*)::int AS sessions,
      COUNT(DISTINCT distinct_id)::int AS unique_visitors
    FROM channel_sessions
    GROUP BY 1, 2
  ),
  channel_orders AS (
    SELECT
      segment,
      operational_channel,
      COUNT(*)::int AS orders,
      COALESCE(SUM(total_price), 0)::float AS revenue
    FROM (
      SELECT DISTINCT ON (o.id)
        o.id,
        o.total_price,
        cs.segment,
        cs.operational_channel
      FROM orders o
      JOIN channel_sessions cs
        ON cs.order_id = o.shopify_order_id
        OR cs.order_id = o.id::text
      WHERE o.deleted_at IS NULL
        AND o.include_in_ecommerce_analytics = true
        AND o.status IN ('paid', 'fulfilled')
        AND o.placed_at >= $1::timestamptz
        AND o.placed_at < $2::timestamptz
      ORDER BY o.id, cs.last_event_at DESC
    ) attributed
    GROUP BY 1, 2
  ),
  segment_rows AS (
    SELECT
      ct.segment,
      ct.operational_channel,
      ct.sessions,
      ct.unique_visitors,
      COALESCE(co.orders, 0)::int AS orders,
      COALESCE(co.revenue, 0)::float AS revenue
    FROM channel_traffic ct
    LEFT JOIN channel_orders co
      ON co.segment = ct.segment
      AND co.operational_channel = ct.operational_channel
  ),
  total_rows AS (
    SELECT
      'total'::text AS segment,
      operational_channel,
      SUM(sessions)::int AS sessions,
      SUM(unique_visitors)::int AS unique_visitors,
      SUM(orders)::int AS orders,
      SUM(revenue)::float AS revenue
    FROM segment_rows
    GROUP BY 1, 2
  )
  SELECT *
  FROM (
    SELECT * FROM segment_rows
    UNION ALL
    SELECT * FROM total_rows
  ) rows
  ORDER BY
    CASE segment WHEN 'unknown' THEN 1 WHEN 'known_no_purchase' THEN 2 WHEN 'returning_customer' THEN 3 ELSE 4 END,
    sessions DESC,
    operational_channel ASC
  `
}

function segmentCte(): string {
  return `
  day_sessions AS (
    SELECT *
    FROM visitor_sessions
    WHERE deleted_at IS NULL
      AND started_at >= $1::timestamptz
      AND started_at < $2::timestamptz
  ),
  day_visitors AS (
    SELECT DISTINCT distinct_id
    FROM day_sessions
  ),
  prior_emails AS (
    SELECT dv.distinct_id, LOWER(NULLIF(vs.email_at_session_start, '')) AS email
    FROM day_visitors dv
    JOIN visitor_sessions vs ON vs.distinct_id = dv.distinct_id
    WHERE vs.deleted_at IS NULL AND vs.started_at < $1::timestamptz AND vs.email_at_session_start IS NOT NULL
    UNION ALL
    SELECT dv.distinct_id, LOWER(NULLIF(vs.email_at_session_end, '')) AS email
    FROM day_visitors dv
    JOIN visitor_sessions vs ON vs.distinct_id = dv.distinct_id
    WHERE vs.deleted_at IS NULL AND vs.started_at < $1::timestamptz AND vs.email_at_session_end IS NOT NULL
    UNION ALL
    SELECT dv.distinct_id, LOWER(NULLIF(c.email, '')) AS email
    FROM day_visitors dv
    JOIN carts c ON c.distinct_id = dv.distinct_id
    WHERE c.deleted_at IS NULL
      AND c.last_action_at < $1::timestamptz
      AND c.email IS NOT NULL
    UNION ALL
    SELECT dv.distinct_id, LOWER(NULLIF(c.email, '')) AS email
    FROM day_visitors dv
    JOIN contacts c ON c.distinct_id = dv.distinct_id
    WHERE c.deleted_at IS NULL
      AND c.created_at < $1::timestamptz
      AND c.email IS NOT NULL
  ),
  visitor_identity AS (
    SELECT distinct_id, MIN(email) AS email
    FROM prior_emails
    WHERE email IS NOT NULL AND email LIKE '%@%'
    GROUP BY 1
  ),
  visitor_segments AS (
    SELECT
      dv.distinct_id,
      CASE
        WHEN vi.email IS NULL THEN 'unknown'
        WHEN EXISTS (
          SELECT 1
          FROM orders o
          WHERE o.deleted_at IS NULL
            AND o.status IN ('paid', 'fulfilled')
            AND o.placed_at < $1::timestamptz
            AND (
              LOWER(o.email) = vi.email
              OR EXISTS (
                SELECT 1
                FROM order_contact oc
                JOIN contacts c
                  ON c.deleted_at IS NULL
                  AND c.id::text = oc.contact_id
                WHERE oc.deleted_at IS NULL
                  AND oc.order_id = o.id::text
                  AND LOWER(c.email) = vi.email
              )
            )
        ) THEN 'returning_customer'
        ELSE 'known_no_purchase'
      END AS segment
    FROM day_visitors dv
    LEFT JOIN visitor_identity vi ON vi.distinct_id = dv.distinct_id
  )`
}

function buildSegmentRows(rawRows: SegmentAggRow[], summary: MetricRow): DailyReportSegmentRow[] {
  const bySegment = new Map(rawRows.map((row) => [row.segment, row]))
  const rows: DailyReportSegmentRow[] = ['unknown', 'known_no_purchase', 'returning_customer', 'unattributed'].map(
    (segment) => {
      const raw = bySegment.get(segment)
      const metric = {
        sessions: toNumber(raw?.sessions),
        unique_visitors: toNumber(raw?.unique_visitors),
        orders: toNumber(raw?.orders),
        revenue: roundMoney(toNumber(raw?.revenue)),
      }
      return toSegmentRow(segment as SegmentKey, metric)
    },
  )
  rows.push(toSegmentRow('total', summary))
  return rows
}

function toSegmentRow(segment: SegmentKey, metric: MetricRow): DailyReportSegmentRow {
  return {
    segment,
    label: SEGMENT_LABELS[segment],
    ...metric,
    average_order_value: ratio(metric.revenue, metric.orders),
    session_conversion_rate: metric.sessions > 0 ? ratio(metric.orders, metric.sessions) : null,
    visitor_conversion_rate: metric.unique_visitors > 0 ? ratio(metric.orders, metric.unique_visitors) : null,
  }
}

function kpi(label: string, value: string): string {
  return `<div class="kpi"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`
}

function renderSegmentTable(payload: DailyReportPayload): string {
  return table(
    'Segments',
    ['Segment', 'Sessions', 'Visiteurs', 'Commandes', 'CA', 'Conv. visiteurs'],
    payload.segments.map((row) => [
      row.label,
      formatInteger(row.sessions),
      formatInteger(row.unique_visitors),
      formatInteger(row.orders),
      formatMoney(row.revenue),
      formatPercent(row.visitor_conversion_rate),
    ]),
  )
}

function renderCountryTable(payload: DailyReportPayload): string {
  return table(
    'Pays livres',
    ['Pays', 'Commandes', 'CA'],
    payload.countries.map((row) => [row.country_name, formatInteger(row.orders), formatMoney(row.revenue)]),
  )
}

function renderSourceTable(payload: DailyReportPayload): string {
  return table(
    'Sources de trafic',
    ['Source', 'Sessions', 'Part', 'Visiteurs', 'Commandes', 'CA'],
    payload.sources.map((row) => [
      row.source,
      formatInteger(row.sessions),
      formatPercent(row.session_share),
      formatInteger(row.unique_visitors),
      formatInteger(row.orders),
      formatMoney(row.revenue),
    ]),
  )
}

function renderChannelTable(payload: DailyReportPayload): string {
  return table(
    'Canaux operationnels par segment',
    ['Segment', 'Canal', 'Sessions', 'Visiteurs', 'Commandes', 'CA'],
    payload.channel_segments.map((row) => [
      row.segment_label,
      row.channel,
      formatInteger(row.sessions),
      formatInteger(row.unique_visitors),
      formatInteger(row.orders),
      formatMoney(row.revenue),
    ]),
  )
}

function table(title: string, headers: string[], rows: string[][]): string {
  return `<h2>${escapeHtml(title)}</h2><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`
}

function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null
  return numerator / denominator
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value)
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value)
}

function formatNullableMoney(value: number | null): string {
  return value === null ? '-' : formatMoney(value)
}

function formatPercent(value: number | null): string {
  return value === null
    ? '-'
    : new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
        value,
      )
}

function formatLongDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: DAILY_REPORT_TIMEZONE }).format(
    new Date(Date.UTC(year, month - 1, date, 12)),
  )
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: DAILY_REPORT_TIMEZONE,
  }).format(new Date(iso))
}

function formatTimeRange(payload: DailyReportPayload): string {
  return `${formatDateTime(payload.period.start_utc)} -> ${formatDateTime(payload.period.end_utc)}`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function datePartsInTimeZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
  }
}

function zonedDateTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  const offset = timeZoneOffsetMs(timeZone, guess)
  return new Date(guess.getTime() - offset)
}

function timeZoneOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  )
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  )
  return asUtc - date.getTime()
}

interface BaseRow {
  sessions: number | string
  unique_visitors: number | string
  source_max_last_event_at: Date | string | null
}

interface OrderSummaryRow {
  orders: number | string
  revenue: number | string
  sold_countries_count: number | string
}

interface SegmentAggRow {
  segment: string
  sessions: number | string
  unique_visitors: number | string
  orders: number | string
  revenue: number | string
}

interface SourceAggRow {
  source_label: string
  sessions: number | string
  unique_visitors: number | string
  orders: number | string
  revenue: number | string
}

interface ChannelAggRow {
  segment: string
  operational_channel: string
  sessions: number | string
  unique_visitors: number | string
  orders: number | string
  revenue: number | string
}

interface CountryRow {
  country_code: string
  country_name: string
  orders: number | string
  revenue: number | string
}
