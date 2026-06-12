import { computeActivityState } from '../../modules/cart-tracking/abandonment'
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

type CartRow = {
  highest_stage: string | null
  last_action_at: string | Date | null
  total_price: number | null
}

type EventRow = {
  valid: boolean
  identity_muid: string | null
  identity_email_sha256: string | null
  distinct_id: string | null
  received_at: string | Date
}

type MessageRow = {
  status: string
  sent_at: string | Date | null
}

type CaseRow = {
  recovered_at: string | Date | null
  recovered_amount: number | string | null
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
  name: 'system-dashboard',
  description: 'Landing dashboard for Palas business KPIs and persisted nightly system health audits.',
  input: z.object({}),
  handler: async (_input, { query }) => {
    const now = new Date()
    const [auditRuns, business] = await Promise.all([loadLatestAudit(query), loadBusinessKpis(query, now)])
    const latestRun = auditRuns[0] ?? null
    const findings = latestRun ? await loadFindings(query, latestRun.id) : []
    const health = latestRun?.summary?.health?.length ? latestRun.summary.health : DEFAULT_HEALTH
    const auditStatus = latestRun?.overall_status ?? 'unknown'
    const status = latestRun?.status === 'failed' ? 'critical' : auditStatus

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
  },
})

async function loadLatestAudit(query: { graph(input: unknown): Promise<unknown> }): Promise<AuditRunRow[]> {
  try {
    return (await query.graph({
      entity: 'systemAuditRun',
      fields: ['id', 'trigger', 'status', 'overall_status', 'started_at', 'finished_at', 'summary', 'error_message'],
      sort: { started_at: 'desc' },
      pagination: { limit: 1, offset: 0 },
    })) as AuditRunRow[]
  } catch {
    return []
  }
}

async function loadFindings(
  query: { graph(input: unknown): Promise<unknown> },
  runId: string,
): Promise<AuditFindingRow[]> {
  try {
    const rows = (await query.graph({
      entity: 'systemAuditFinding',
      filters: { run_id: runId },
      fields: ['id', 'source', 'key', 'severity', 'title', 'summary', 'count', 'href', 'details', 'observed_at'],
      sort: { observed_at: 'desc' },
      pagination: { limit: 50, offset: 0 },
    })) as AuditFindingRow[]
    return rows.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
  } catch {
    return []
  }
}

async function loadBusinessKpis(query: { graph(input: unknown): Promise<unknown> }, now: Date) {
  const from30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const from24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const [carts, events, messages, cases] = await Promise.all([
    safeGraph<CartRow>(query, {
      entity: 'cart',
      filters: { last_action_at: { $gte: from30 } },
      fields: ['highest_stage', 'last_action_at', 'total_price'],
      pagination: { limit: 5000, offset: 0 },
    }),
    safeGraph<EventRow>(query, {
      entity: 'eventLog',
      filters: { received_at: { $gte: from24 } },
      fields: ['valid', 'identity_muid', 'identity_email_sha256', 'distinct_id', 'received_at'],
      pagination: { limit: 10000, offset: 0 },
    }),
    safeGraph<MessageRow>(query, {
      entity: 'abandonedCartMessage',
      filters: { sent_at: { $gte: from30 } },
      fields: ['status', 'sent_at'],
      pagination: { limit: 5000, offset: 0 },
    }),
    safeGraph<CaseRow>(query, {
      entity: 'abandonedCartCase',
      filters: { recovered_at: { $gte: from30 } },
      fields: ['recovered_at', 'recovered_amount'],
      pagination: { limit: 5000, offset: 0 },
    }),
  ])

  let completed = 0
  let abandonedRevenue = 0
  let active = 0
  for (const cart of carts) {
    const activity = computeActivityState(cart, now.getTime())
    const price = money(cart.total_price)
    if (activity === 'completed') completed++
    else if (activity === 'browsing' || activity === 'dormant') active++
    else if (price > 0) abandonedRevenue += price
  }

  const identifiedEvents = events.filter(
    (event) => event.identity_muid || event.identity_email_sha256 || event.distinct_id,
  )
  const sentMessages = messages.filter((message) => message.status === 'sent')
  const recoveredRevenue = cases.reduce((sum, row) => sum + money(row.recovered_amount), 0)

  return {
    carts_30d: carts.length,
    active_carts_30d: active,
    completed_30d: completed,
    abandoned_revenue_30d: roundMoney(abandonedRevenue),
    identified_event_rate_24h: rate(identifiedEvents.length, events.length),
    events_24h: events.length,
    sent_recovery_emails_30d: sentMessages.length,
    recovered_cases_30d: cases.length,
    recovery_rate_30d: rate(cases.length, sentMessages.length),
    recovered_revenue_30d: roundMoney(recoveredRevenue),
  }
}

async function safeGraph<T>(query: { graph(input: unknown): Promise<unknown> }, input: unknown): Promise<T[]> {
  try {
    return (await query.graph(input)) as T[]
  } catch {
    return []
  }
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function money(value: number | string | null | undefined): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0
  return Number.isFinite(n) ? n : 0
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function rate(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 10000) / 10000 : 0
}

function severityRank(severity: AuditFindingRow['severity']): number {
  if (severity === 'critical') return 0
  if (severity === 'warning') return 1
  return 2
}
