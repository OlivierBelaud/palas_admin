import { sqlActivityStateCase } from '../../modules/cart-tracking/abandonment'
import { type RawDb, resolveRawDb } from '../../utils/raw-db'
import type { SystemHealthCard, SystemStatus } from '../../utils/system-audit'

type AuditRunRow = {
  id: string
  trigger: 'nightly' | 'manual'
  status: 'running' | 'completed' | 'failed'
  overall_status: SystemStatus
  started_at: string | Date
  finished_at: string | Date | null
  summary: { health?: SystemHealthCard[]; metrics?: Record<string, number | string | null> } | null
  error_message: string | null
}

type AuditFindingRow = {
  id: string
  source: string
  key: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  summary: string
  count: number
  href: string | null
  details: string[] | null
  observed_at: string | Date
}

type RunningAuditRow = {
  id: string
  started_at: string | Date
}

type BusinessKpiRow = {
  carts_30d: string | number
  active_carts_30d: string | number
  completed_30d: string | number
  abandoned_revenue_30d: string | number | null
  identified_events_24h: string | number
  events_24h: string | number
  sent_recovery_emails_30d: string | number
  recovered_cases_30d: string | number
  recovered_revenue_30d: string | number | null
}

const DEFAULT_HEALTH: SystemHealthCard[] = [
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

export default defineQuery({
  name: 'system-dashboard-loader',
  description: 'Landing dashboard for Palas business KPIs and persisted nightly system health audits.',
  input: z.object({}),
  handler: async (_input, ctx) => {
    return loadSystemDashboardData(resolveRawDb(ctx))
  },
})

export async function loadSystemDashboardData(db: RawDb) {
  const now = new Date()
  const [auditRuns, staleRunningAudits, business] = await Promise.all([
    loadLatestAudit(db),
    loadLatestStaleRunningAudit(db),
    loadBusinessKpis(db),
  ])
  const latestRun = auditRuns[0] ?? null
  const staleRunningAudit = unresolvedStaleRunningAudit(staleRunningAudits[0] ?? null, latestRun)
  const persistedFindings = latestRun ? await loadFindings(db, latestRun.id) : []
  const health = latestRun?.summary?.health?.length ? latestRun.summary.health : DEFAULT_HEALTH
  const auditStatus = latestRun?.overall_status ?? 'unknown'
  const status = latestRun?.status === 'failed' || staleRunningAudit ? 'critical' : auditStatus
  const findings = persistedFindings.map((finding) => ({
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
  }))
  if (staleRunningAudit) findings.unshift(staleRunningAuditFinding(staleRunningAudit, now))

  return {
    meta: {
      generated_at: now.toISOString(),
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
    business,
    health,
    findings,
    audits: health.map((item) => ({
      key: item.key,
      label: item.label,
      status: item.status === 'ok' ? 'passing' : item.status === 'unknown' ? 'unknown' : 'failing',
      last_run_at: latestRun?.finished_at ? iso(latestRun.finished_at) : null,
      href: item.href,
    })),
  }
}

async function loadLatestAudit(db: RawDb): Promise<AuditRunRow[]> {
  return db.raw<AuditRunRow>(
    `SELECT id, trigger, status, overall_status, started_at, finished_at, summary, error_message
       FROM system_audit_runs
      WHERE deleted_at IS NULL
        AND status IN ('completed', 'failed')
      ORDER BY started_at DESC
      LIMIT 1`,
  )
}

async function loadLatestStaleRunningAudit(db: RawDb): Promise<RunningAuditRow[]> {
  return db.raw<RunningAuditRow>(
    `SELECT id, started_at
       FROM system_audit_runs
      WHERE deleted_at IS NULL
        AND status = 'running'
        AND started_at < NOW() - INTERVAL '30 minutes'
      ORDER BY started_at DESC
      LIMIT 1`,
  )
}

async function loadFindings(db: RawDb, runId: string): Promise<AuditFindingRow[]> {
  return db.raw<AuditFindingRow>(
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

async function loadBusinessKpis(db: RawDb) {
  const [row] = await db.raw<BusinessKpiRow>(
    `WITH carts_30 AS (
       SELECT highest_stage, last_action_at, total_price, ${sqlActivityStateCase()} AS activity_state
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
       (SELECT COALESCE(SUM(COALESCE(recovered_amount::numeric, 0)), 0) FROM cases_30)::text AS recovered_revenue_30d`,
  )

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

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function staleRunningAuditFinding(audit: RunningAuditRow, observedAt: Date) {
  const startedAt = iso(audit.started_at)
  return {
    id: `stale-audit:${audit.id}`,
    source: 'system',
    key: 'audit_stuck',
    severity: 'critical' as const,
    title: 'Audit système bloqué',
    summary: `Le run ${audit.id} est encore en cours plus de 30 minutes après son démarrage.`,
    count: 1,
    href: '/',
    details: [`Démarré à ${startedAt}`],
    observed_at: observedAt.toISOString(),
  }
}

function unresolvedStaleRunningAudit(
  staleRunningAudit: RunningAuditRow | null,
  latestTerminalAudit: AuditRunRow | null,
): RunningAuditRow | null {
  if (!staleRunningAudit || !latestTerminalAudit) return staleRunningAudit
  return new Date(staleRunningAudit.started_at).getTime() > new Date(latestTerminalAudit.started_at).getTime()
    ? staleRunningAudit
    : null
}

function toNumber(value: number | string | null | undefined): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0
  return Number.isFinite(n) ? n : 0
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function rate(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 10000) / 10000 : 0
}
