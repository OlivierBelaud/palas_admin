import {
  db,
  iso,
  json,
  nowMs,
  rate,
  requireAdmin,
  roundMoney,
  timingHeader,
  toNumber,
  unauthorized,
} from './runtime.mjs'

const DEFAULT_HEALTH = [
  {
    key: 'shopify',
    label: 'Shopify',
    status: 'unknown',
    summary: 'Aucun audit système disponible.',
    details: ['Le cron nocturne n’a pas encore écrit de run.'],
    href: '/orders',
  },
  {
    key: 'posthog',
    label: 'PostHog events',
    status: 'unknown',
    summary: 'Aucun audit système disponible.',
    details: ['Le cron nocturne n’a pas encore écrit de run.'],
    href: '/tracking-health',
  },
  {
    key: 'klaviyo',
    label: 'Klaviyo',
    status: 'unknown',
    summary: 'Aucun audit système disponible.',
    details: ['Le cron nocturne n’a pas encore écrit de run.'],
    href: '/paniers-abandonnes',
  },
  {
    key: 'event_hub',
    label: 'Event Hub',
    status: 'unknown',
    summary: 'Aucun audit système disponible.',
    details: ['Le cron nocturne n’a pas encore écrit de run.'],
    href: '/tracking-health',
  },
  {
    key: 'abandoned_cart_emails',
    label: 'Emails panier',
    status: 'unknown',
    summary: 'Aucun audit système disponible.',
    details: ['Le cron nocturne n’a pas encore écrit de run.'],
    href: '/paniers-abandonnes/emails',
  },
]

export default {
  async fetch(req) {
    const started = nowMs()
    const auth = requireAdmin(req)
    if (!auth) return unauthorized()
    const authDone = nowMs()

    const [auditRuns, businessRows] = await Promise.all([loadLatestAudit(), loadBusinessKpis()])
    const latestRun = auditRuns[0] ?? null
    const findings = latestRun ? await loadFindings(latestRun.id) : []
    const queryDone = nowMs()

    const health = latestRun?.summary?.health?.length ? latestRun.summary.health : DEFAULT_HEALTH
    const auditStatus = latestRun?.overall_status ?? 'unknown'
    const status = latestRun?.status === 'failed' ? 'critical' : auditStatus
    const data = {
      meta: {
        generated_at: new Date().toISOString(),
        audit_run: latestRun
          ? {
              id: latestRun.id,
              trigger: latestRun.trigger,
              status: latestRun.status,
              overall_status: latestRun.overall_status,
              started_at: iso(latestRun.started_at),
              finished_at: latestRun.finished_at ? iso(latestRun.finished_at) : null,
              error_message: latestRun.error_message,
            }
          : null,
      },
      status,
      business: normalizeBusiness(businessRows[0]),
      health,
      findings: findings.map((finding) => ({
        id: finding.id,
        source: finding.source,
        key: finding.key,
        severity: finding.severity,
        title: finding.title,
        summary: finding.summary,
        count: finding.count,
        href: finding.href ?? '/',
        details: finding.details ?? [],
        observed_at: iso(finding.observed_at),
      })),
      audits: health.map((item) => ({
        key: item.key,
        label: item.label,
        status: item.status === 'ok' ? 'passing' : item.status === 'unknown' ? 'unknown' : 'failing',
        last_run_at: latestRun?.finished_at ? iso(latestRun.finished_at) : null,
        href: item.href,
      })),
    }
    const serializeDone = nowMs()

    return json(
      { data },
      {
        headers: {
          'server-timing': timingHeader({
            auth: authDone - started,
            query: queryDone - authDone,
            serialize: serializeDone - queryDone,
            total: serializeDone - started,
          }),
        },
      },
    )
  },
}

async function loadLatestAudit() {
  return db().unsafe(`SELECT id, trigger, status, overall_status, started_at, finished_at, summary, error_message
       FROM system_audit_runs
      WHERE deleted_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1`)
}

async function loadFindings(runId) {
  return db().unsafe(
    `SELECT id, source, key, severity, title, summary, count, href, details, observed_at
       FROM system_audit_findings
      WHERE run_id = $1
        AND deleted_at IS NULL
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
               observed_at DESC
      LIMIT 50`,
    [runId],
  )
}

async function loadBusinessKpis() {
  return db().unsafe(`WITH carts_30 AS (
       SELECT highest_stage, last_action_at, total_price,
              CASE
                WHEN highest_stage = 'completed' THEN 'completed'
                WHEN EXTRACT(EPOCH FROM (now() - last_action_at)) < 7200 THEN 'browsing'
                WHEN EXTRACT(EPOCH FROM (now() - last_action_at)) >= 604800 THEN 'dead'
                ELSE 'dormant'
              END AS activity_state
         FROM carts
        WHERE deleted_at IS NULL
          AND last_action_at >= NOW() - INTERVAL '30 days'
     ),
     events_24 AS (
       SELECT identity_muid, identity_email_sha256, distinct_id
         FROM event_logs
        WHERE deleted_at IS NULL
          AND received_at >= NOW() - INTERVAL '24 hours'
     ),
     messages_30 AS (
       SELECT status
         FROM abandoned_cart_messages
        WHERE deleted_at IS NULL
          AND sent_at >= NOW() - INTERVAL '30 days'
     ),
     cases_30 AS (
       SELECT recovered_amount
         FROM abandoned_cart_cases
        WHERE deleted_at IS NULL
          AND recovered_at >= NOW() - INTERVAL '30 days'
     )
     SELECT
       (SELECT COUNT(*) FROM carts_30)::text AS carts_30d,
       (SELECT COUNT(*) FROM carts_30 WHERE activity_state IN ('browsing', 'dormant'))::text AS active_carts_30d,
       (SELECT COUNT(*) FROM carts_30 WHERE activity_state = 'completed')::text AS completed_30d,
       (SELECT COALESCE(SUM(COALESCE(total_price, 0)), 0)
          FROM carts_30
         WHERE activity_state NOT IN ('browsing', 'dormant', 'completed'))::text AS abandoned_revenue_30d,
       (SELECT COUNT(*) FROM events_24)::text AS events_24h,
       (SELECT COUNT(*)
          FROM events_24
         WHERE identity_muid IS NOT NULL
            OR identity_email_sha256 IS NOT NULL
            OR distinct_id IS NOT NULL)::text AS identified_events_24h,
       (SELECT COUNT(*) FROM messages_30 WHERE status = 'sent')::text AS sent_recovery_emails_30d,
       (SELECT COUNT(*) FROM cases_30)::text AS recovered_cases_30d,
       (SELECT COALESCE(SUM(COALESCE(recovered_amount::numeric, 0)), 0) FROM cases_30)::text AS recovered_revenue_30d`)
}

function normalizeBusiness(row) {
  const events = toNumber(row?.events_24h)
  const identifiedEvents = toNumber(row?.identified_events_24h)
  const sentMessages = toNumber(row?.sent_recovery_emails_30d)
  const recoveredCases = toNumber(row?.recovered_cases_30d)

  return {
    carts_30d: toNumber(row?.carts_30d),
    active_carts_30d: toNumber(row?.active_carts_30d),
    completed_30d: toNumber(row?.completed_30d),
    abandoned_revenue_30d: roundMoney(toNumber(row?.abandoned_revenue_30d)),
    identified_event_rate_24h: rate(identifiedEvents, events),
    events_24h: events,
    sent_recovery_emails_30d: sentMessages,
    recovered_cases_30d: recoveredCases,
    recovery_rate_30d: rate(recoveredCases, sentMessages),
    recovered_revenue_30d: roundMoney(toNumber(row?.recovered_revenue_30d)),
  }
}
