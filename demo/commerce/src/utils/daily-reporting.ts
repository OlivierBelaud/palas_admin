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

export interface DailyReportCartSummary {
  carts_created: number
  carts_created_visitors: number
  carts_created_converted: number
  carts_created_conversion_rate: number | null
  carts_updated: number
  carts_updated_sessions: number
  carts_updated_visitors: number
  carts_updated_converted: number
  carts_updated_conversion_rate: number | null
  cart_view_events: number
  cart_view_sessions: number
  cart_view_visitors: number
}

export interface DailyReportCartActivitySegmentRow {
  segment: SegmentKey | 'total'
  segment_label: string
  sessions: number
  unique_visitors: number
  cart_activity_sessions: number
  cart_activity_visitors: number
  cart_update_sessions: number
  cart_update_visitors: number
  cart_update_events: number
  cart_view_sessions: number
  cart_view_visitors: number
  cart_view_events: number
  order_sessions: number
}

export interface DailyReportCartBirthSegmentRow {
  segment: SegmentKey | 'total'
  segment_label: string
  carts_born: number
  carts_born_with_email: number
  cart_visitors: number
  orders_same_day: number
  revenue_same_day: number
}

export interface DailyReportAbandonedCartEmailRow {
  message_type: 'abandoned_cart_1' | 'abandoned_cart_2' | 'abandoned_cart_3'
  label: string
  sent: number
  opens: number | null
  open_rate: number | null
  clicks: number
  click_rate: number | null
  conversions: number
  conversion_rate: number | null
  revenue: number
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
  cart_summary: DailyReportCartSummary
  cart_activity_segments: DailyReportCartActivitySegmentRow[]
  cart_birth_segments: DailyReportCartBirthSegmentRow[]
  abandoned_cart_emails: DailyReportAbandonedCartEmailRow[]
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
  idempotencySuffix?: string
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
    OR COALESCE(first_url, '') ILIKE '%gbraid=%'
    OR COALESCE(first_url, '') ILIKE '%wbraid=%'
    OR COALESCE(first_url, '') ILIKE '%gad_source=%'
    OR COALESCE(first_url, '') ILIKE '%gad_campaignid=%'
    THEN 'Google Ads'
  WHEN COALESCE(utm_source, '') ILIKE '%instagram%'
    OR COALESCE(referring_domain, '') ILIKE '%instagram%'
    OR COALESCE(utm_source, '') ILIKE '%facebook%'
    OR COALESCE(referring_domain, '') ILIKE '%facebook%'
    OR COALESCE(utm_source, '') ILIKE '%meta%'
    OR COALESCE(first_url, '') ILIKE '%fbclid=%'
    THEN 'Meta Ads'
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
  WHEN COALESCE(referring_domain, '') ILIKE '%google.%'
    OR COALESCE(referring_domain, '') = 'www.google.com'
    OR COALESCE(referring_domain, '') = 'com.google.android.googlequicksearchbox'
    THEN 'SEO'
  WHEN COALESCE(referring_domain, '') ILIKE '%bing.%'
    OR COALESCE(referring_domain, '') ILIKE '%ecosia.%'
    OR COALESCE(referring_domain, '') ILIKE '%qwant.%'
    THEN 'SEO'
  WHEN COALESCE(referring_domain, '') IN ('fancypalas.com', 'int.fancypalas.com')
    THEN 'Navigation interne'
  WHEN COALESCE(referring_domain, '') = '$direct'
    AND COALESCE(utm_source, '') = ''
    AND COALESCE(utm_medium, '') = ''
    AND COALESCE(first_url, '') NOT ILIKE '%gclid=%'
    AND COALESCE(first_url, '') NOT ILIKE '%gbraid=%'
    AND COALESCE(first_url, '') NOT ILIKE '%wbraid=%'
    AND COALESCE(first_url, '') NOT ILIKE '%gad_source=%'
    AND COALESCE(first_url, '') NOT ILIKE '%fbclid=%'
    AND COALESCE(first_url, '') NOT ILIKE '%ttclid=%'
    AND COALESCE(first_url, '') NOT ILIKE '%epik=%'
    THEN 'Direct'
  WHEN COALESCE(referring_domain, '') = 'admin.shopify.com'
    THEN 'Admin Shopify'
  ELSE 'Autres sources'
END`

const OPERATIONAL_CHANNEL_CASE = `
CASE
  WHEN source_label IN ('Google Ads', 'Meta Ads', 'TikTok Ads', 'Pinterest Ads', 'Paid media - unknown')
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
      AND placed_at >= $1::timestamptz
      AND placed_at < $2::timestamptz
    `,
    [startIso, endIso],
  )

  const rawSegmentRows = await sql.unsafe<SegmentAggRow[]>(segmentAggSql(), [startIso, endIso])
  const rawSourceRows = await sql.unsafe<SourceAggRow[]>(sourceAggSql(), [startIso, endIso])
  const rawChannelRows = await sql.unsafe<ChannelAggRow[]>(channelAggSql(), [startIso, endIso])
  const [cartSummaryRow] = await sql.unsafe<CartSummaryRow[]>(cartSummarySql(), [startIso, endIso])
  const rawCartActivityRows = await sql.unsafe<CartActivityAggRow[]>(cartActivityAggSql(), [startIso, endIso])
  const rawCartBirthRows = await sql.unsafe<CartBirthAggRow[]>(cartBirthAggSql(), [startIso, endIso])
  const abandonedCartEmailRows = await sql.unsafe<AbandonedCartEmailAggRow[]>(abandonedCartEmailSql(), [
    startIso,
    endIso,
  ])
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
  const cartSummary = buildCartSummary(cartSummaryRow)

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
    cart_summary: cartSummary,
    cart_activity_segments: buildCartActivityRows(rawCartActivityRows),
    cart_birth_segments: buildCartBirthRows(rawCartBirthRows),
    abandoned_cart_emails: buildAbandonedCartEmailRows(abandonedCartEmailRows),
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
  const snapshotStatus = dailyReportSnapshotStatus(payload)
  await storeDailyReportSnapshot(options.sql, payload, snapshotStatus)

  const recipients = options.recipients ?? dailyReportRecipientsFromEnv()
  const html = renderDailyReportHtml(payload)
  const text = renderDailyReportText(payload)
  const subject =
    snapshotStatus === 'ready'
      ? `Reporting Palas - ${formatLongDay(payload.day)}`
      : `[PARTIEL] Reporting Palas - ${formatLongDay(payload.day)}`
  const idempotencyScope = options.idempotencySuffix ? `:${options.idempotencySuffix}` : ''
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
      idempotency_key: `daily-report:${payload.day}:${to}${idempotencyScope}`,
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

export function dailyReportSnapshotStatus(payload: DailyReportPayload): 'ready' | 'partial' {
  if (payload.summary.sessions <= 0) return 'partial'
  if (payload.summary.unattributed_orders > 0) return 'partial'
  if (isSessionSourceStale(payload)) return 'partial'
  return 'ready'
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
    .kpi-table{width:100%;border-collapse:separate;border-spacing:0;margin:22px 0 18px;font-size:13px}
    .kpi-cell{width:25%;border:1px solid #ebe6df;border-left:0;padding:12px 14px;vertical-align:top;background:#fff}
    .kpi-row .kpi-cell:first-child{border-left:1px solid #ebe6df}
    .kpi-row:first-child .kpi-cell:first-child{border-top-left-radius:7px}
    .kpi-row:first-child .kpi-cell:last-child{border-top-right-radius:7px}
    .kpi-row:last-child .kpi-cell{border-top:0}
    .kpi-row:last-child .kpi-cell:first-child{border-bottom-left-radius:7px}
    .kpi-row:last-child .kpi-cell:last-child{border-bottom-right-radius:7px}
    .kpi-label{font-size:11px;line-height:1.25;text-transform:uppercase;letter-spacing:.04em;color:#706a60;white-space:nowrap}
    .kpi-value{font-size:21px;line-height:1.15;font-weight:700;margin-top:6px;color:#161412;white-space:nowrap}
    table{border-collapse:collapse;width:100%;font-size:13px}
    th,td{padding:9px 8px;border-bottom:1px solid #eee8df;text-align:right;vertical-align:top}
    th:first-child,td:first-child{text-align:left}
    th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#706a60;background:#faf8f4}
    .note{font-size:13px;line-height:1.45;color:#4c463f}
    .muted{color:#706a60}
    @media(max-width:620px){.content,.head{padding-left:18px;padding-right:18px}table{font-size:12px}.kpi-cell{padding:10px 8px}.kpi-label{font-size:10px}.kpi-value{font-size:17px}}
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
        ${renderKpiSummaryTable(payload)}
        ${renderCartSummaryTable(payload)}
        ${renderCartActivityTable(payload)}
        ${renderCartBirthTable(payload)}
        ${renderAbandonedCartEmailTable(payload)}
        ${renderSegmentTable(payload)}
        ${renderCountryTable(payload)}
        ${renderSourceTable(payload)}
        ${renderChannelTable(payload)}
        ${renderDefinitionNotes()}
        <p class="note muted">Controle qualite : source sessions max ${payload.summary.source_max_last_event_at ? formatDateTime(payload.summary.source_max_last_event_at) : 'non disponible'} ; commandes sans session exploitable ${payload.summary.unattributed_orders} (${formatMoney(payload.summary.unattributed_revenue)}).</p>
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
    `Commandes sans session exploitable: ${payload.summary.unattributed_orders} (${formatMoney(payload.summary.unattributed_revenue)})`,
    '',
    'Paniers:',
    `- Paniers nes: ${formatInteger(payload.cart_summary.carts_created)} paniers, ${formatInteger(payload.cart_summary.carts_created_visitors)} visiteurs, ${formatInteger(payload.cart_summary.carts_created_converted)} commandes le meme jour`,
    `- Updates panier: ${formatInteger(payload.cart_summary.carts_updated)} evenements, ${formatInteger(payload.cart_summary.carts_updated_visitors)} visiteurs, ${formatInteger(payload.cart_summary.carts_updated_sessions)} sessions, ${formatInteger(payload.cart_summary.carts_updated_converted)} sessions avec commande`,
    `- Vues panier: ${formatInteger(payload.cart_summary.cart_view_events)} evenements, ${formatInteger(payload.cart_summary.cart_view_visitors)} visiteurs, ${formatInteger(payload.cart_summary.cart_view_sessions)} sessions`,
    ...abandonedCartEmailTextLines(payload),
    '',
    'Segments:',
    ...payload.segments
      .filter((row) => row.segment !== 'unattributed')
      .map(
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
    '',
    'Definitions rapides:',
    '- Sources de trafic: detail par source detectee au niveau session.',
    '- Canaux operationnels par segment: regroupement actionnable des sources, croise avec inconnus / prospects / clients.',
    '- Commandes sans session: commandes Shopify sans session visiteur rattachee en base.',
  ]
  return lines.join('\n')
}

function abandonedCartEmailTextLines(payload: DailyReportPayload): string[] {
  if (!hasMeasuredAbandonedCartEmailMetrics(payload)) return []
  return [
    '',
    'Relances panier CRM:',
    ...payload.abandoned_cart_emails.map(
      (row) =>
        `- ${row.label}: ${formatInteger(row.sent)} envoyes, ouvertures ${formatIntegerOrDash(row.opens)} (${formatPercent(row.open_rate)}), clics ${formatInteger(row.clicks)} (${formatPercent(row.click_rate)}), conversions ${formatInteger(row.conversions)} (${formatPercent(row.conversion_rate)}), CA ${formatMoney(row.revenue)}`,
    ),
  ]
}

function segmentAggSql(): string {
  return `
  WITH ${segmentCte()},
  segment_traffic AS (
    SELECT
      COALESCE(ds.segment_at_session_start, 'unknown') AS segment,
      COUNT(*)::int AS sessions,
      COUNT(DISTINCT ds.distinct_id)::int AS unique_visitors
    FROM day_sessions ds
    GROUP BY 1
  ),
  segment_orders AS (
    SELECT
      segment,
      COUNT(*)::int AS orders,
      COALESCE(SUM(total_price), 0)::float AS revenue
    FROM attributed_order_sessions
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
    LEFT JOIN attributed_order_sessions ao ON ao.order_row_id = o.id
    WHERE o.deleted_at IS NULL
      AND o.include_in_ecommerce_analytics = true
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
    SELECT so.segment, 0::int AS sessions, 0::int AS unique_visitors, so.orders, so.revenue
    FROM segment_orders so
    LEFT JOIN segment_traffic st ON st.segment = so.segment
    WHERE st.segment IS NULL
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
  classified_order_sessions AS (
    SELECT aos.*, ${SOURCE_CASE} AS source_label
    FROM attributed_order_sessions aos
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
    FROM classified_order_sessions
    GROUP BY 1
  )
  SELECT
    COALESCE(st.source_label, so.source_label) AS source_label,
    COALESCE(st.sessions, 0)::int AS sessions,
    COALESCE(st.unique_visitors, 0)::int AS unique_visitors,
    COALESCE(so.orders, 0)::int AS orders,
    COALESCE(so.revenue, 0)::float AS revenue
  FROM source_traffic st
  FULL JOIN source_orders so ON so.source_label = st.source_label
  ORDER BY COALESCE(st.sessions, 0) DESC, COALESCE(st.source_label, so.source_label) ASC
  `
}

function channelAggSql(): string {
  return `
  WITH ${segmentCte()},
  classified_sessions AS (
    SELECT ds.*, COALESCE(ds.segment_at_session_start, 'unknown') AS segment, ${SOURCE_CASE} AS source_label
    FROM day_sessions ds
  ),
  classified_order_sessions AS (
    SELECT aos.*, ${SOURCE_CASE} AS source_label
    FROM attributed_order_sessions aos
  ),
  channel_sessions AS (
    SELECT *, ${OPERATIONAL_CHANNEL_CASE} AS operational_channel
    FROM classified_sessions
  ),
  channel_order_sessions AS (
    SELECT *, ${OPERATIONAL_CHANNEL_CASE} AS operational_channel
    FROM classified_order_sessions
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
    FROM channel_order_sessions
    GROUP BY 1, 2
  ),
  segment_rows AS (
    SELECT
      COALESCE(ct.segment, co.segment) AS segment,
      COALESCE(ct.operational_channel, co.operational_channel) AS operational_channel,
      COALESCE(ct.sessions, 0)::int AS sessions,
      COALESCE(ct.unique_visitors, 0)::int AS unique_visitors,
      COALESCE(co.orders, 0)::int AS orders,
      COALESCE(co.revenue, 0)::float AS revenue
    FROM channel_traffic ct
    FULL JOIN channel_orders co
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

function cartSummarySql(): string {
  return `
  WITH born_carts AS (
    SELECT *
    FROM carts
    WHERE deleted_at IS NULL
      AND (
        (cart_birth_at >= $1::timestamptz AND cart_birth_at < $2::timestamptz)
        OR (cart_birth_at IS NULL AND created_at >= $1::timestamptz AND created_at < $2::timestamptz)
      )
  ),
  carts_created AS (
    SELECT
      COUNT(*)::int AS carts_created,
      COUNT(DISTINCT bc.distinct_id)::int AS carts_created_visitors,
      COUNT(DISTINCT bc.id) FILTER (WHERE o.id IS NOT NULL)::int AS carts_created_converted
    FROM born_carts bc
    LEFT JOIN cart_order co
      ON co.deleted_at IS NULL
      AND co.cart_id = bc.id
    LEFT JOIN orders o
      ON o.deleted_at IS NULL
      AND o.include_in_ecommerce_analytics = true
      AND o.placed_at >= $1::timestamptz
      AND o.placed_at < $2::timestamptz
      AND (
        o.id::text = co.order_id
        OR o.shopify_order_id = bc.shopify_order_id
      )
  ),
  carts_updated AS (
    SELECT
      COALESCE(SUM(carts_updated_in_session), 0)::int AS carts_updated,
      COUNT(*) FILTER (WHERE carts_updated_in_session > 0)::int AS carts_updated_sessions,
      COUNT(DISTINCT distinct_id) FILTER (WHERE carts_updated_in_session > 0)::int AS carts_updated_visitors,
      COUNT(*) FILTER (WHERE carts_updated_in_session > 0 AND order_id IS NOT NULL)::int AS carts_updated_converted,
      COALESCE(SUM(carts_viewed_in_session), 0)::int AS cart_view_events,
      COUNT(*) FILTER (WHERE carts_viewed_in_session > 0)::int AS cart_view_sessions,
      COUNT(DISTINCT distinct_id) FILTER (WHERE carts_viewed_in_session > 0)::int AS cart_view_visitors
    FROM visitor_sessions
    WHERE deleted_at IS NULL
      AND started_at >= $1::timestamptz
      AND started_at < $2::timestamptz
  )
  SELECT
    cc.carts_created,
    cc.carts_created_visitors,
    cc.carts_created_converted,
    cu.carts_updated,
    cu.carts_updated_sessions,
    cu.carts_updated_visitors,
    cu.carts_updated_converted,
    cu.cart_view_events,
    cu.cart_view_sessions,
    cu.cart_view_visitors
  FROM carts_created cc
  CROSS JOIN carts_updated cu
  `
}

function cartActivityAggSql(): string {
  return `
  WITH day_sessions AS (
    SELECT *
    FROM visitor_sessions
    WHERE deleted_at IS NULL
      AND started_at >= $1::timestamptz
      AND started_at < $2::timestamptz
  ),
  segment_rows AS (
    SELECT
      COALESCE(segment_at_session_start, 'unknown') AS segment,
      COUNT(*)::int AS sessions,
      COUNT(DISTINCT distinct_id)::int AS unique_visitors,
      COUNT(*) FILTER (WHERE carts_created_in_session > 0 OR carts_updated_in_session > 0 OR carts_viewed_in_session > 0)::int AS cart_activity_sessions,
      COUNT(DISTINCT distinct_id) FILTER (WHERE carts_created_in_session > 0 OR carts_updated_in_session > 0 OR carts_viewed_in_session > 0)::int AS cart_activity_visitors,
      COUNT(*) FILTER (WHERE carts_updated_in_session > 0)::int AS cart_update_sessions,
      COUNT(DISTINCT distinct_id) FILTER (WHERE carts_updated_in_session > 0)::int AS cart_update_visitors,
      COALESCE(SUM(carts_updated_in_session), 0)::int AS cart_update_events,
      COUNT(*) FILTER (WHERE carts_viewed_in_session > 0)::int AS cart_view_sessions,
      COUNT(DISTINCT distinct_id) FILTER (WHERE carts_viewed_in_session > 0)::int AS cart_view_visitors,
      COALESCE(SUM(carts_viewed_in_session), 0)::int AS cart_view_events,
      COUNT(*) FILTER (WHERE order_id IS NOT NULL)::int AS order_sessions
    FROM day_sessions
    GROUP BY 1
  ),
  total_row AS (
    SELECT
      'total'::text AS segment,
      COUNT(*)::int AS sessions,
      COUNT(DISTINCT distinct_id)::int AS unique_visitors,
      COUNT(*) FILTER (WHERE carts_created_in_session > 0 OR carts_updated_in_session > 0 OR carts_viewed_in_session > 0)::int AS cart_activity_sessions,
      COUNT(DISTINCT distinct_id) FILTER (WHERE carts_created_in_session > 0 OR carts_updated_in_session > 0 OR carts_viewed_in_session > 0)::int AS cart_activity_visitors,
      COUNT(*) FILTER (WHERE carts_updated_in_session > 0)::int AS cart_update_sessions,
      COUNT(DISTINCT distinct_id) FILTER (WHERE carts_updated_in_session > 0)::int AS cart_update_visitors,
      COALESCE(SUM(carts_updated_in_session), 0)::int AS cart_update_events,
      COUNT(*) FILTER (WHERE carts_viewed_in_session > 0)::int AS cart_view_sessions,
      COUNT(DISTINCT distinct_id) FILTER (WHERE carts_viewed_in_session > 0)::int AS cart_view_visitors,
      COALESCE(SUM(carts_viewed_in_session), 0)::int AS cart_view_events,
      COUNT(*) FILTER (WHERE order_id IS NOT NULL)::int AS order_sessions
    FROM day_sessions
  )
  SELECT *
  FROM (
    SELECT * FROM segment_rows
    UNION ALL
    SELECT * FROM total_row
  ) rows
  ORDER BY CASE segment WHEN 'unknown' THEN 1 WHEN 'known_no_purchase' THEN 2 WHEN 'returning_customer' THEN 3 ELSE 4 END
  `
}

function cartBirthAggSql(): string {
  return `
  WITH born_carts AS (
    SELECT *
    FROM carts
    WHERE deleted_at IS NULL
      AND (
        (cart_birth_at >= $1::timestamptz AND cart_birth_at < $2::timestamptz)
        OR (cart_birth_at IS NULL AND created_at >= $1::timestamptz AND created_at < $2::timestamptz)
      )
  ),
  birth_segments AS (
    SELECT DISTINCT ON (bc.id)
      bc.id,
      bc.distinct_id,
      bc.email,
      bc.shopify_order_id,
      COALESCE(vs.segment_at_session_start, 'unknown') AS segment
    FROM born_carts bc
    LEFT JOIN visitor_sessions vs
      ON vs.deleted_at IS NULL
      AND vs.distinct_id = bc.distinct_id
      AND vs.started_at >= $1::timestamptz
      AND vs.started_at < $2::timestamptz
    ORDER BY bc.id, ABS(EXTRACT(EPOCH FROM (COALESCE(bc.cart_birth_at, bc.created_at) - vs.started_at))) NULLS LAST
  ),
  linked_orders AS (
    SELECT DISTINCT bc.id AS cart_id, o.id AS order_id, o.total_price
    FROM born_carts bc
    JOIN cart_order co
      ON co.deleted_at IS NULL
      AND co.cart_id = bc.id
    JOIN orders o
      ON o.deleted_at IS NULL
      AND o.include_in_ecommerce_analytics = true
      AND o.id::text = co.order_id
      AND o.placed_at >= $1::timestamptz
      AND o.placed_at < $2::timestamptz
    UNION
    SELECT DISTINCT bc.id AS cart_id, o.id AS order_id, o.total_price
    FROM born_carts bc
    JOIN orders o
      ON o.deleted_at IS NULL
      AND o.include_in_ecommerce_analytics = true
      AND o.shopify_order_id = bc.shopify_order_id
      AND o.placed_at >= $1::timestamptz
      AND o.placed_at < $2::timestamptz
  ),
  segment_rows AS (
    SELECT
      bs.segment,
      COUNT(DISTINCT bs.id)::int AS carts_born,
      COUNT(DISTINCT bs.id) FILTER (WHERE bs.email IS NOT NULL)::int AS carts_born_with_email,
      COUNT(DISTINCT bs.distinct_id)::int AS cart_visitors,
      COUNT(DISTINCT lo.order_id)::int AS orders_same_day,
      COALESCE(SUM(lo.total_price), 0)::float AS revenue_same_day
    FROM birth_segments bs
    LEFT JOIN linked_orders lo ON lo.cart_id = bs.id
    GROUP BY 1
  ),
  total_row AS (
    SELECT
      'total'::text AS segment,
      COUNT(DISTINCT bs.id)::int AS carts_born,
      COUNT(DISTINCT bs.id) FILTER (WHERE bs.email IS NOT NULL)::int AS carts_born_with_email,
      COUNT(DISTINCT bs.distinct_id)::int AS cart_visitors,
      COUNT(DISTINCT lo.order_id)::int AS orders_same_day,
      COALESCE(SUM(lo.total_price), 0)::float AS revenue_same_day
    FROM birth_segments bs
    LEFT JOIN linked_orders lo ON lo.cart_id = bs.id
  )
  SELECT *
  FROM (
    SELECT * FROM segment_rows
    UNION ALL
    SELECT * FROM total_row
  ) rows
  ORDER BY CASE segment WHEN 'unknown' THEN 1 WHEN 'known_no_purchase' THEN 2 WHEN 'returning_customer' THEN 3 ELSE 4 END
  `
}

function abandonedCartEmailSql(): string {
  return `
  WITH typed(message_type, label, sort_order) AS (
    VALUES
      ('abandoned_cart_1', 'Email 1', 1),
      ('abandoned_cart_2', 'Email 2', 2),
      ('abandoned_cart_3', 'Email 3', 3)
  ),
  sent_messages AS (
    SELECT *
    FROM abandoned_cart_messages
    WHERE deleted_at IS NULL
      AND status = 'sent'
      AND message_type IN ('abandoned_cart_1', 'abandoned_cart_2', 'abandoned_cart_3')
      AND sent_at >= $1::timestamptz
      AND sent_at < $2::timestamptz
  ),
  click_sessions AS (
    SELECT
      CASE
        WHEN first_url ILIKE '%utm_content=abandoned_cart_1%' THEN 'abandoned_cart_1'
        WHEN first_url ILIKE '%utm_content=abandoned_cart_2%' THEN 'abandoned_cart_2'
        WHEN first_url ILIKE '%utm_content=abandoned_cart_3%' THEN 'abandoned_cart_3'
        ELSE NULL
      END AS message_type,
      COUNT(*)::int AS clicks
    FROM visitor_sessions
    WHERE deleted_at IS NULL
      AND started_at >= $1::timestamptz
      AND started_at < $2::timestamptz
      AND first_url ILIKE '%palas_email_type=abandoned_cart%'
      AND (
        first_url ILIKE '%utm_content=abandoned_cart_1%'
        OR first_url ILIKE '%utm_content=abandoned_cart_2%'
        OR first_url ILIKE '%utm_content=abandoned_cart_3%'
      )
    GROUP BY 1
  ),
  recoveries AS (
    SELECT
      m.message_type,
      COUNT(c.id)::int AS conversions,
      COALESCE(SUM(c.recovered_amount), 0)::float AS revenue
    FROM sent_messages m
    JOIN abandoned_cart_cases c
      ON c.deleted_at IS NULL
      AND c.recovered_source_message_id = m.id
    GROUP BY m.message_type
  )
  SELECT
    t.message_type,
    t.label,
    COUNT(m.id)::int AS sent,
    NULL::int AS opens,
    COALESCE(cs.clicks, 0)::int AS clicks,
    COALESCE(r.conversions, 0)::int AS conversions,
    COALESCE(r.revenue, 0)::float AS revenue
  FROM typed t
  LEFT JOIN sent_messages m ON m.message_type = t.message_type
  LEFT JOIN click_sessions cs ON cs.message_type = t.message_type
  LEFT JOIN recoveries r ON r.message_type = t.message_type
  GROUP BY t.message_type, t.label, t.sort_order, cs.clicks, r.conversions, r.revenue
  ORDER BY t.sort_order ASC
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
  attributed_order_sessions AS (
    SELECT DISTINCT ON (o.id)
      o.id AS order_row_id,
      o.shopify_order_id,
      o.total_price,
      vs.id AS session_row_id,
      vs.distinct_id,
      COALESCE(vs.segment_at_session_start, 'unknown') AS segment,
      vs.started_at,
      vs.last_event_at,
      vs.first_url,
      vs.utm_source,
      vs.utm_medium,
      vs.utm_campaign,
      vs.referring_domain,
      vs.is_paid_session
    FROM orders o
    JOIN visitor_sessions vs
      ON vs.deleted_at IS NULL
      AND (
        vs.order_id = o.shopify_order_id
        OR vs.order_id = o.id::text
      )
    WHERE o.deleted_at IS NULL
      AND o.include_in_ecommerce_analytics = true
      AND o.placed_at >= $1::timestamptz
      AND o.placed_at < $2::timestamptz
    ORDER BY o.id, vs.last_event_at DESC
  )`
}

function buildCartSummary(row: CartSummaryRow | undefined): DailyReportCartSummary {
  const cartsCreated = toNumber(row?.carts_created)
  const cartsCreatedVisitors = toNumber(row?.carts_created_visitors)
  const cartsCreatedConverted = toNumber(row?.carts_created_converted)
  const cartsUpdated = toNumber(row?.carts_updated)
  const cartsUpdatedSessions = toNumber(row?.carts_updated_sessions)
  const cartsUpdatedVisitors = toNumber(row?.carts_updated_visitors)
  const cartsUpdatedConverted = toNumber(row?.carts_updated_converted)
  return {
    carts_created: cartsCreated,
    carts_created_visitors: cartsCreatedVisitors,
    carts_created_converted: cartsCreatedConverted,
    carts_created_conversion_rate: ratio(cartsCreatedConverted, cartsCreated),
    carts_updated: cartsUpdated,
    carts_updated_sessions: cartsUpdatedSessions,
    carts_updated_visitors: cartsUpdatedVisitors,
    carts_updated_converted: cartsUpdatedConverted,
    carts_updated_conversion_rate: ratio(cartsUpdatedConverted, cartsUpdatedSessions),
    cart_view_events: toNumber(row?.cart_view_events),
    cart_view_sessions: toNumber(row?.cart_view_sessions),
    cart_view_visitors: toNumber(row?.cart_view_visitors),
  }
}

function buildCartActivityRows(rows: CartActivityAggRow[]): DailyReportCartActivitySegmentRow[] {
  return rows.map((row) => ({
    segment: row.segment as SegmentKey | 'total',
    segment_label: row.segment === 'total' ? SEGMENT_LABELS.total : SEGMENT_LABELS[row.segment as SegmentKey],
    sessions: toNumber(row.sessions),
    unique_visitors: toNumber(row.unique_visitors),
    cart_activity_sessions: toNumber(row.cart_activity_sessions),
    cart_activity_visitors: toNumber(row.cart_activity_visitors),
    cart_update_sessions: toNumber(row.cart_update_sessions),
    cart_update_visitors: toNumber(row.cart_update_visitors),
    cart_update_events: toNumber(row.cart_update_events),
    cart_view_sessions: toNumber(row.cart_view_sessions),
    cart_view_visitors: toNumber(row.cart_view_visitors),
    cart_view_events: toNumber(row.cart_view_events),
    order_sessions: toNumber(row.order_sessions),
  }))
}

function buildCartBirthRows(rows: CartBirthAggRow[]): DailyReportCartBirthSegmentRow[] {
  return rows.map((row) => ({
    segment: row.segment as SegmentKey | 'total',
    segment_label: row.segment === 'total' ? SEGMENT_LABELS.total : SEGMENT_LABELS[row.segment as SegmentKey],
    carts_born: toNumber(row.carts_born),
    carts_born_with_email: toNumber(row.carts_born_with_email),
    cart_visitors: toNumber(row.cart_visitors),
    orders_same_day: toNumber(row.orders_same_day),
    revenue_same_day: roundMoney(toNumber(row.revenue_same_day)),
  }))
}

function buildAbandonedCartEmailRows(rows: AbandonedCartEmailAggRow[]): DailyReportAbandonedCartEmailRow[] {
  return rows.map((row) => {
    const sent = toNumber(row.sent)
    const opens = toNullableNumber(row.opens)
    const clicks = toNumber(row.clicks)
    const conversions = toNumber(row.conversions)
    return {
      message_type: row.message_type,
      label: row.label,
      sent,
      opens,
      open_rate: opens === null ? null : ratio(opens, sent),
      clicks,
      click_rate: ratio(clicks, sent),
      conversions,
      conversion_rate: ratio(conversions, sent),
      revenue: roundMoney(toNumber(row.revenue)),
    }
  })
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

function renderKpiSummaryTable(payload: DailyReportPayload): string {
  const rows = [
    [
      ['Sessions', formatInteger(payload.summary.sessions)],
      ['Visiteurs', formatInteger(payload.summary.unique_visitors)],
      ['Commandes', formatInteger(payload.summary.orders)],
      ['CA', formatMoney(payload.summary.revenue)],
    ],
    [
      ['Panier moyen', formatNullableMoney(payload.summary.average_order_value)],
      ['Conv. visiteurs', formatPercent(payload.summary.visitor_conversion_rate)],
      ['Pays vendus', formatInteger(payload.summary.sold_countries_count)],
      ['Cmd sans session', `${payload.summary.unattributed_orders} cmd`],
    ],
  ]

  return `<table class="kpi-table" role="presentation" cellpadding="0" cellspacing="0">
    <tbody>
      ${rows
        .map(
          (row) => `<tr class="kpi-row">
            ${row.map(([label, value]) => kpiCell(label, value)).join('')}
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>`
}

function kpiCell(label: string, value: string): string {
  return `<td class="kpi-cell">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${escapeHtml(value)}</div>
  </td>`
}

function renderSegmentTable(payload: DailyReportPayload): string {
  return table(
    'Segments',
    ['Segment', 'Sessions', 'Visiteurs', 'Commandes', 'CA', 'Conv. visiteurs'],
    payload.segments
      .filter((row) => row.segment !== 'unattributed')
      .map((row) => [
        row.label,
        formatInteger(row.sessions),
        formatInteger(row.unique_visitors),
        formatInteger(row.orders),
        formatMoney(row.revenue),
        formatPercent(row.visitor_conversion_rate),
      ]),
  )
}

function renderCartSummaryTable(payload: DailyReportPayload): string {
  const c = payload.cart_summary
  return table(
    'Synthese panier',
    ['Signal', 'Visiteurs', 'Sessions', 'Volume', 'Commandes'],
    [
      [
        'Paniers nes',
        formatInteger(c.carts_created_visitors),
        '-',
        formatInteger(c.carts_created),
        formatInteger(c.carts_created_converted),
      ],
      [
        'Updates panier',
        formatInteger(c.carts_updated_visitors),
        formatInteger(c.carts_updated_sessions),
        formatInteger(c.carts_updated),
        formatInteger(c.carts_updated_converted),
      ],
      [
        'Vues panier',
        formatInteger(c.cart_view_visitors),
        formatInteger(c.cart_view_sessions),
        formatInteger(c.cart_view_events),
        '-',
      ],
    ],
  )
}

function renderCartActivityTable(payload: DailyReportPayload): string {
  return table(
    'Activite panier par segment',
    ['Segment', 'Visiteurs actifs', 'Sessions actives', 'Vues', 'Updates', 'Visiteurs update', 'Sessions commande'],
    payload.cart_activity_segments.map((row) => [
      row.segment_label,
      formatInteger(row.cart_activity_visitors),
      formatInteger(row.cart_activity_sessions),
      formatInteger(row.cart_view_events),
      formatInteger(row.cart_update_events),
      formatInteger(row.cart_update_visitors),
      formatInteger(row.order_sessions),
    ]),
  )
}

function renderCartBirthTable(payload: DailyReportPayload): string {
  return table(
    'Paniers nes',
    ['Segment', 'Paniers', 'Visiteurs', 'Avec email', 'Commandes meme jour', 'CA meme jour'],
    payload.cart_birth_segments.map((row) => [
      row.segment_label,
      formatInteger(row.carts_born),
      formatInteger(row.cart_visitors),
      formatInteger(row.carts_born_with_email),
      formatInteger(row.orders_same_day),
      formatMoney(row.revenue_same_day),
    ]),
  )
}

function renderAbandonedCartEmailTable(payload: DailyReportPayload): string {
  if (!hasMeasuredAbandonedCartEmailMetrics(payload)) return ''

  const body = table(
    'Relances panier CRM',
    ['Email', 'Envoyes', 'Ouvertures', 'Taux ouv.', 'Clics', 'Taux clic', 'Conv.', 'Taux conv.', 'CA'],
    payload.abandoned_cart_emails.map((row) => [
      row.label,
      formatInteger(row.sent),
      formatIntegerOrDash(row.opens),
      formatPercent(row.open_rate),
      formatInteger(row.clicks),
      formatPercent(row.click_rate),
      formatInteger(row.conversions),
      formatPercent(row.conversion_rate),
      formatMoney(row.revenue),
    ]),
  )
  return `${body}<p class="note muted">Les clics correspondent aux sessions arrivees via les liens de relance tagues Email 1/2/3. Les conversions et le CA sont rattaches au message CRM source quand le cas panier est marque recupere. Les ouvertures restent affichees a "-" tant que les evenements d'ouverture email ne sont pas synchronises en base.</p>`
}

function hasMeasuredAbandonedCartEmailMetrics(payload: DailyReportPayload): boolean {
  return payload.abandoned_cart_emails.some(
    (row) => row.opens !== null || row.clicks > 0 || row.conversions > 0 || row.revenue > 0,
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

function renderDefinitionNotes(): string {
  return `<h2>Definitions rapides</h2>
  <p class="note"><strong>Paniers nes</strong> compte les paniers distincts dont le premier signal est dans la journee. Ce n'est pas un nombre de personnes : un meme visiteur peut creer plusieurs paniers.</p>
  <p class="note"><strong>Updates panier</strong> compte les evenements de modification panier. Les colonnes visiteurs et sessions indiquent combien de personnes/sessions ont porte ces evenements.</p>
  <p class="note"><strong>Commandes meme jour</strong> compte uniquement les commandes Shopify incluses dans l'analytics ecommerce et rattachees a ces paniers, placees dans la meme journee de reporting.</p>
  <p class="note"><strong>Sources de trafic</strong> detaille les sources d'acquisition detectees au niveau session : Google Ads, Meta Ads, SEO, Direct, Klaviyo, relance panier, etc.</p>
  <p class="note"><strong>Canaux operationnels par segment</strong> regroupe ces sources en familles actionnables, puis les croise avec le segment client : inconnus, prospects, clients. C'est la vue la plus utile pour piloter les budgets et les actions CRM.</p>
  <p class="note"><strong>Commandes sans session</strong> designe les commandes Shopify incluses dans l'analytics ecommerce mais sans session visiteur rattachee dans la base. Causes typiques : achat hors navigateur suivi, paiement finalise plus tard, session expiree/non synchronisee, tracking bloque, ou rapprochement cart/order incomplet.</p>`
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

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  return toNumber(value)
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value)
}

function formatIntegerOrDash(value: number | null): string {
  return value === null ? '-' : formatInteger(value)
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

function isSessionSourceStale(payload: DailyReportPayload): boolean {
  if (!payload.summary.source_max_last_event_at) return true
  const maxEventAt = new Date(payload.summary.source_max_last_event_at).getTime()
  const periodEnd = new Date(payload.period.end_utc).getTime()
  if (!Number.isFinite(maxEventAt) || !Number.isFinite(periodEnd)) return true
  return periodEnd - maxEventAt > 2 * 60 * 60 * 1000
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

interface CartSummaryRow {
  carts_created: number | string
  carts_created_visitors: number | string
  carts_created_converted: number | string
  carts_updated: number | string
  carts_updated_sessions: number | string
  carts_updated_visitors: number | string
  carts_updated_converted: number | string
  cart_view_events: number | string
  cart_view_sessions: number | string
  cart_view_visitors: number | string
}

interface CartActivityAggRow {
  segment: string
  sessions: number | string
  unique_visitors: number | string
  cart_activity_sessions: number | string
  cart_activity_visitors: number | string
  cart_update_sessions: number | string
  cart_update_visitors: number | string
  cart_update_events: number | string
  cart_view_sessions: number | string
  cart_view_visitors: number | string
  cart_view_events: number | string
  order_sessions: number | string
}

interface CartBirthAggRow {
  segment: string
  carts_born: number | string
  carts_born_with_email: number | string
  cart_visitors: number | string
  orders_same_day: number | string
  revenue_same_day: number | string
}

interface AbandonedCartEmailAggRow {
  message_type: 'abandoned_cart_1' | 'abandoned_cart_2' | 'abandoned_cart_3'
  label: string
  sent: number | string
  opens: number | string | null
  clicks: number | string
  conversions: number | string
  revenue: number | string
}

interface CountryRow {
  country_code: string
  country_name: string
  orders: number | string
  revenue: number | string
}
