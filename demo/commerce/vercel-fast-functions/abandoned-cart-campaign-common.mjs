import { clampInt, db, iso, rate, roundMoney, toNumber } from './runtime.mjs'

export const MESSAGE_TYPES = ['abandoned_cart_1', 'abandoned_cart_2', 'abandoned_cart_3', 'payment_help_1']

export function rangeFromUrl(req) {
  const url = new URL(req.url)
  const from = new Date(url.searchParams.get('from') ?? '')
  const to = new Date(url.searchParams.get('to') ?? '')
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    return { error: { type: 'INVALID_DATA', message: 'Invalid date range' } }
  }
  return { from, to, url }
}

export function listInputFromUrl(req) {
  const parsed = rangeFromUrl(req)
  if (parsed.error) return parsed
  const { url } = parsed
  return {
    ...parsed,
    limit: clampInt(url.searchParams.get('limit'), 50, 1, 200),
    offset: clampInt(url.searchParams.get('offset'), 0, 0, 100_000),
    status: normalizeFilter(url.searchParams.get('status')),
    search: normalizeSearch(url.searchParams.get('search')),
  }
}

export async function loadDashboard(from, to) {
  const fromIso = from.toISOString()
  const toIso = to.toISOString()
  const [kpiRows, byTypeRows, skipRows, caseDayRows, messageDayRows, recoveredDayRows] = await Promise.all([
    db().unsafe(
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
      [fromIso, toIso],
    ),
    db().unsafe(
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
      [fromIso, toIso, MESSAGE_TYPES],
    ),
    db().unsafe(
      `SELECT COALESCE(skip_reason, 'unknown') AS skip_reason, COUNT(*)::text AS count
         FROM abandoned_cart_messages
        WHERE deleted_at IS NULL
          AND status = 'skipped'
          AND COALESCE(sent_at, updated_at, scheduled_for) >= $1::timestamptz
          AND COALESCE(sent_at, updated_at, scheduled_for) < $2::timestamptz
        GROUP BY COALESCE(skip_reason, 'unknown')
        ORDER BY COUNT(*) DESC
        LIMIT 20`,
      [fromIso, toIso],
    ),
    db().unsafe(
      `SELECT date_trunc('day', opened_at)::date::text AS date, COUNT(*)::text AS cases_opened
         FROM abandoned_cart_cases
        WHERE deleted_at IS NULL
          AND opened_at >= $1::timestamptz
          AND opened_at < $2::timestamptz
        GROUP BY 1
        ORDER BY 1`,
      [fromIso, toIso],
    ),
    db().unsafe(
      `SELECT date_trunc('day', COALESCE(sent_at, updated_at, scheduled_for))::date::text AS date,
              COUNT(*) FILTER (WHERE status = 'sent')::text AS sent,
              COUNT(*) FILTER (WHERE status = 'skipped')::text AS skipped,
              COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
              COUNT(*) FILTER (WHERE message_type = 'abandoned_cart_1' AND status = 'sent')::text AS abandoned_cart_1,
              COUNT(*) FILTER (WHERE message_type = 'abandoned_cart_2' AND status = 'sent')::text AS abandoned_cart_2,
              COUNT(*) FILTER (WHERE message_type = 'abandoned_cart_3' AND status = 'sent')::text AS abandoned_cart_3,
              COUNT(*) FILTER (WHERE message_type = 'payment_help_1' AND status = 'sent')::text AS payment_help_1
         FROM abandoned_cart_messages
        WHERE deleted_at IS NULL
          AND COALESCE(sent_at, updated_at, scheduled_for) >= $1::timestamptz
          AND COALESCE(sent_at, updated_at, scheduled_for) < $2::timestamptz
        GROUP BY 1
        ORDER BY 1`,
      [fromIso, toIso],
    ),
    db().unsafe(
      `SELECT date_trunc('day', recovered_at)::date::text AS date,
              COUNT(*)::text AS recovered,
              COALESCE(SUM(recovered_amount), 0)::text AS recovered_revenue
         FROM abandoned_cart_cases
        WHERE deleted_at IS NULL
          AND recovered_at >= $1::timestamptz
          AND recovered_at < $2::timestamptz
        GROUP BY 1
        ORDER BY 1`,
      [fromIso, toIso],
    ),
  ])

  const kpis = normalizeKpis(kpiRows[0])
  const sentMessages = kpis.sent_messages
  const recoveredFromSent = kpis.recovered_from_sent_messages
  kpis.recovery_rate = rate(recoveredFromSent, sentMessages)

  return {
    meta: {
      range: { from: fromIso, to: toIso },
      generated_at: new Date().toISOString(),
    },
    kpis,
    by_type: byTypeRows.map((row) => {
      const sent = toNumber(row.sent)
      const recovered = toNumber(row.recovered)
      return {
        message_type: row.message_type,
        sent,
        skipped: toNumber(row.skipped),
        pending: toNumber(row.pending),
        failed: toNumber(row.failed),
        recovered,
        recovery_rate: rate(recovered, sent),
        recovered_revenue: roundMoney(toNumber(row.recovered_revenue)),
      }
    }),
    skip_reasons: skipRows.map((row) => ({ skip_reason: row.skip_reason, count: toNumber(row.count) })),
    daily: buildDailyRows(from, to, caseDayRows, messageDayRows, recoveredDayRows),
  }
}

export async function loadCaseList({ from, to, limit, offset, status, search }) {
  const rows = await db().unsafe(
    `WITH scoped_cases AS (
       SELECT c.*,
              GREATEST(
                COALESCE(c.opened_at, 'epoch'::timestamptz),
                COALESCE(c.last_cart_action_at, 'epoch'::timestamptz),
                COALESCE(c.recovered_at, 'epoch'::timestamptz),
                COALESCE(MAX(m.sent_at), 'epoch'::timestamptz)
              ) AS last_activity_at,
              COUNT(m.id) FILTER (WHERE m.status = 'sent')::int AS messages_sent,
              MAX(m.sent_at) FILTER (WHERE m.status = 'sent') AS last_sent_at,
              MIN(m.scheduled_for) FILTER (
                WHERE m.status = 'pending'
                  AND m.sequence_version = COALESCE(c.current_sequence_version, 1)
              ) AS next_due_at,
              MAX(m.sequence_version)::int AS total_sequences,
              MAX(m.message_type) FILTER (WHERE m.id = c.recovered_source_message_id) AS recovered_by_message_type,
              MAX(CASE WHEN m.status = 'skipped' THEN 'skipped:' || COALESCE(m.skip_reason, 'unknown') ELSE m.status END) FILTER (
                WHERE m.message_type = 'abandoned_cart_1'
                  AND m.sequence_version = COALESCE(c.current_sequence_version, 1)
              ) AS email_1,
              MAX(CASE WHEN m.status = 'skipped' THEN 'skipped:' || COALESCE(m.skip_reason, 'unknown') ELSE m.status END) FILTER (
                WHERE m.message_type = 'abandoned_cart_2'
                  AND m.sequence_version = COALESCE(c.current_sequence_version, 1)
              ) AS email_2,
              MAX(CASE WHEN m.status = 'skipped' THEN 'skipped:' || COALESCE(m.skip_reason, 'unknown') ELSE m.status END) FILTER (
                WHERE m.message_type = 'abandoned_cart_3'
                  AND m.sequence_version = COALESCE(c.current_sequence_version, 1)
              ) AS email_3,
              MAX(CASE WHEN m.status = 'skipped' THEN 'skipped:' || COALESCE(m.skip_reason, 'unknown') ELSE m.status END) FILTER (
                WHERE m.message_type = 'payment_help_1'
                  AND m.sequence_version = COALESCE(c.current_sequence_version, 1)
              ) AS payment_help,
              COUNT(DISTINCT ch.id) FILTER (WHERE ch.status = 'blocked')::int AS checks_blocked,
              COUNT(DISTINCT ch.id) FILTER (WHERE ch.status = 'error')::int AS checks_error
         FROM abandoned_cart_cases c
         LEFT JOIN abandoned_cart_messages m ON m.case_id = c.id AND m.deleted_at IS NULL
         LEFT JOIN abandoned_cart_checks ch ON ch.case_id = c.id AND ch.deleted_at IS NULL
        WHERE c.deleted_at IS NULL
          AND (
            (c.opened_at >= $1::timestamptz AND c.opened_at < $2::timestamptz)
            OR EXISTS (
              SELECT 1
                FROM abandoned_cart_messages wm
               WHERE wm.case_id = c.id
                 AND wm.deleted_at IS NULL
                 AND COALESCE(wm.sent_at, wm.updated_at, wm.scheduled_for) >= $1::timestamptz
                 AND COALESCE(wm.sent_at, wm.updated_at, wm.scheduled_for) < $2::timestamptz
            )
          )
          AND ($3::text IS NULL OR c.status = $3 OR c.case_type = $3)
          AND (
            $4::text IS NULL
            OR lower(c.email) LIKE '%' || lower($4) || '%'
            OR lower(c.case_type) LIKE '%' || lower($4) || '%'
            OR lower(c.status) LIKE '%' || lower($4) || '%'
          )
        GROUP BY c.id
     )
     SELECT *, COUNT(*) OVER()::text AS total_count
       FROM scoped_cases
      ORDER BY last_activity_at DESC NULLS LAST, opened_at DESC
      LIMIT $5 OFFSET $6`,
    [from.toISOString(), to.toISOString(), status, search, limit, offset],
  )

  return {
    items: rows.map((row) => ({
      id: row.id,
      cart_id: row.cart_id,
      email: row.email,
      case_type: row.case_type,
      status: row.status,
      current_sequence_version: row.current_sequence_version ?? 1,
      sequence_started_at: isoOrNull(row.sequence_started_at),
      total_sequences: Math.max(row.current_sequence_version ?? 1, row.total_sequences ?? 1),
      stage_at_open: row.stage_at_open,
      opened_at: iso(row.opened_at),
      last_cart_action_at: iso(row.last_cart_action_at),
      last_activity_at: isoOrNull(row.last_activity_at) ?? iso(row.opened_at),
      email_1: row.email_1,
      email_2: row.email_2,
      email_3: row.email_3,
      payment_help: row.payment_help,
      messages_sent: row.messages_sent ?? 0,
      last_sent_at: isoOrNull(row.last_sent_at),
      next_due_at: isoOrNull(row.next_due_at),
      recovered_at: isoOrNull(row.recovered_at),
      recovered_amount: roundMoney(toNumber(row.recovered_amount)),
      recovered_by_message_type: row.recovered_by_message_type,
      checks_blocked: row.checks_blocked ?? 0,
      checks_error: row.checks_error ?? 0,
    })),
    count: toNumber(rows[0]?.total_count),
    limit,
    offset,
  }
}

export async function loadMessageList({ from, to, limit, offset, status, search }) {
  const rows = await db().unsafe(
    `SELECT m.id, m.case_id, m.cart_id, m.email, c.case_type, c.stage_at_open,
            m.message_type, m.sequence_version, m.sequence_started_at, m.status,
            m.scheduled_for, m.sent_at, COALESCE(m.sent_at, m.updated_at, m.scheduled_for) AS activity_at,
            m.provider, m.provider_message_id, m.locale, m.subject, m.snapshot_html_url,
            m.snapshot_error, m.skip_reason, m.error_message,
            (c.recovered_source_message_id = m.id) AS recovered,
            CASE WHEN c.recovered_source_message_id = m.id THEN c.recovered_amount ELSE 0 END AS recovered_amount,
            COUNT(*) OVER()::text AS total_count
       FROM abandoned_cart_messages m
       LEFT JOIN abandoned_cart_cases c ON c.id = m.case_id AND c.deleted_at IS NULL
      WHERE m.deleted_at IS NULL
        AND COALESCE(m.sent_at, m.updated_at, m.scheduled_for) >= $1::timestamptz
        AND COALESCE(m.sent_at, m.updated_at, m.scheduled_for) < $2::timestamptz
        AND ($3::text IS NULL OR m.status = $3 OR m.message_type = $3 OR m.skip_reason = $3)
        AND (
          $4::text IS NULL
          OR lower(m.email) LIKE '%' || lower($4) || '%'
          OR lower(COALESCE(m.subject, '')) LIKE '%' || lower($4) || '%'
          OR lower(COALESCE(m.skip_reason, '')) LIKE '%' || lower($4) || '%'
          OR lower(COALESCE(m.error_message, '')) LIKE '%' || lower($4) || '%'
          OR lower(m.message_type) LIKE '%' || lower($4) || '%'
          OR lower(m.status) LIKE '%' || lower($4) || '%'
        )
      ORDER BY activity_at DESC NULLS LAST
      LIMIT $5 OFFSET $6`,
    [from.toISOString(), to.toISOString(), status, search, limit, offset],
  )

  return {
    items: rows.map((row) => ({
      id: row.id,
      case_id: row.case_id,
      cart_id: row.cart_id,
      email: row.email,
      case_type: row.case_type,
      stage_at_open: row.stage_at_open,
      message_type: row.message_type,
      sequence_version: row.sequence_version ?? 1,
      sequence_started_at: isoOrNull(row.sequence_started_at),
      status: row.status,
      scheduled_for: iso(row.scheduled_for),
      sent_at: isoOrNull(row.sent_at),
      activity_at: isoOrNull(row.activity_at) ?? iso(row.scheduled_for),
      provider: row.provider,
      provider_message_id: row.provider_message_id,
      locale: row.locale,
      subject: row.subject,
      snapshot_html_url: row.snapshot_html_url,
      snapshot_error: row.snapshot_error,
      skip_reason: row.skip_reason,
      error_message: row.error_message,
      recovered: row.recovered === true,
      recovered_amount: roundMoney(toNumber(row.recovered_amount)),
    })),
    count: toNumber(rows[0]?.total_count),
    limit,
    offset,
  }
}

export async function loadCheckList({ from, to, limit, offset, status, search }) {
  const rows = await db().unsafe(
    `SELECT ch.id, ch.case_id, ch.message_id, c.email, c.case_type, m.message_type,
            ch.check_type, ch.status, ch.checked_at, ch.raw_summary,
            COUNT(*) OVER()::text AS total_count
       FROM abandoned_cart_checks ch
       LEFT JOIN abandoned_cart_cases c ON c.id = ch.case_id AND c.deleted_at IS NULL
       LEFT JOIN abandoned_cart_messages m ON m.id = ch.message_id AND m.deleted_at IS NULL
      WHERE ch.deleted_at IS NULL
        AND ch.checked_at >= $1::timestamptz
        AND ch.checked_at < $2::timestamptz
        AND ($3::text IS NULL OR ch.status = $3 OR ch.check_type = $3)
        AND (
          $4::text IS NULL
          OR lower(COALESCE(c.email, '')) LIKE '%' || lower($4) || '%'
          OR lower(ch.check_type) LIKE '%' || lower($4) || '%'
          OR lower(ch.status) LIKE '%' || lower($4) || '%'
          OR lower(COALESCE(ch.raw_summary, '')) LIKE '%' || lower($4) || '%'
        )
      ORDER BY ch.checked_at DESC
      LIMIT $5 OFFSET $6`,
    [from.toISOString(), to.toISOString(), status, search, limit, offset],
  )

  return {
    items: rows.map((row) => ({
      id: row.id,
      case_id: row.case_id,
      message_id: row.message_id,
      email: row.email,
      case_type: row.case_type,
      message_type: row.message_type,
      check_type: row.check_type,
      status: row.status,
      checked_at: iso(row.checked_at),
      raw_summary: row.raw_summary,
    })),
    count: toNumber(rows[0]?.total_count),
    limit,
    offset,
  }
}

function normalizeKpis(row) {
  return {
    cases_opened: toNumber(row?.cases_opened),
    open_cases_total: toNumber(row?.open_cases_total),
    recovered_cases: toNumber(row?.recovered_cases),
    recovered_revenue: roundMoney(toNumber(row?.recovered_revenue)),
    sent_messages: toNumber(row?.sent_messages),
    skipped_messages: toNumber(row?.skipped_messages),
    failed_messages: toNumber(row?.failed_messages),
    due_pending: toNumber(row?.due_pending),
    recovered_from_sent_messages: toNumber(row?.recovered_from_sent_messages),
    recovery_rate: 0,
    shopify_blocks: toNumber(row?.shopify_blocks),
    optout_blocks: toNumber(row?.optout_blocks),
    klaviyo_blocks: toNumber(row?.klaviyo_blocks),
  }
}

function buildDailyRows(from, to, caseRows, messageRows, recoveredRows) {
  const days = new Map()
  for (const day of enumerateDays(from, to)) days.set(day, emptyDaily(day))
  for (const row of caseRows) {
    const daily = days.get(row.date) ?? emptyDaily(row.date)
    daily.cases_opened = toNumber(row.cases_opened)
    days.set(row.date, daily)
  }
  for (const row of messageRows) {
    const daily = days.get(row.date) ?? emptyDaily(row.date)
    daily.sent = toNumber(row.sent)
    daily.skipped = toNumber(row.skipped)
    daily.failed = toNumber(row.failed)
    daily.abandoned_cart_1 = toNumber(row.abandoned_cart_1)
    daily.abandoned_cart_2 = toNumber(row.abandoned_cart_2)
    daily.abandoned_cart_3 = toNumber(row.abandoned_cart_3)
    daily.payment_help_1 = toNumber(row.payment_help_1)
    days.set(row.date, daily)
  }
  for (const row of recoveredRows) {
    const daily = days.get(row.date) ?? emptyDaily(row.date)
    daily.recovered = toNumber(row.recovered)
    daily.recovered_revenue = roundMoney(toNumber(row.recovered_revenue))
    days.set(row.date, daily)
  }
  return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function enumerateDays(from, to) {
  const out = []
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()))
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

function emptyDaily(date) {
  return {
    date,
    cases_opened: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    recovered: 0,
    recovered_revenue: 0,
    abandoned_cart_1: 0,
    abandoned_cart_2: 0,
    abandoned_cart_3: 0,
    payment_help_1: 0,
  }
}

function isoOrNull(value) {
  return value ? iso(value) : null
}

function normalizeFilter(value) {
  return value && value !== 'all' ? value : null
}

function normalizeSearch(value) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
