import { useDashboardContext } from '@mantajs/dashboard'
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@mantajs/ui'
import { Activity, AlertTriangle, CheckCircle2, Clock3, Database, ExternalLink, RefreshCw, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

type SystemStatus = 'ok' | 'warning' | 'critical' | 'unknown'

interface SystemDashboardData {
  meta: {
    generated_at: string
    audit_run: null | {
      id: string
      trigger: 'nightly' | 'manual'
      status: 'running' | 'completed' | 'failed'
      overall_status: SystemStatus
      started_at: string
      finished_at: string | null
      error_message: string | null
    }
  }
  status: SystemStatus
  business: {
    carts_30d: number
    active_carts_30d: number
    completed_30d: number
    abandoned_revenue_30d: number
    identified_event_rate_24h: number
    events_24h: number
    sent_recovery_emails_30d: number
    recovered_cases_30d: number
    recovery_rate_30d: number
    recovered_revenue_30d: number
  }
  health: Array<{
    key: string
    label: string
    status: SystemStatus
    summary: string
    details: string[]
    href: string
  }>
  findings: Array<{
    id: string
    source: string
    key: string
    severity: 'critical' | 'warning' | 'info'
    title: string
    summary: string
    count: number
    href: string
    details: string[]
    observed_at: string
  }>
  audits: Array<{
    key: string
    label: string
    status: 'passing' | 'failing' | 'unknown'
    last_run_at: string | null
    href: string
  }>
}

const statusCopy: Record<SystemStatus, { label: string; className: string; dot: string }> = {
  ok: {
    label: 'Vert',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    dot: 'bg-emerald-500',
  },
  warning: {
    label: 'Attention',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
    dot: 'bg-amber-500',
  },
  critical: {
    label: 'Rouge',
    className: 'border-red-200 bg-red-50 text-red-800',
    dot: 'bg-red-500',
  },
  unknown: {
    label: 'Inconnu',
    className: 'border-slate-200 bg-slate-50 text-slate-700',
    dot: 'bg-slate-400',
  },
}

function authHeaders(authAdapter: ReturnType<typeof useDashboardContext>['authAdapter']) {
  return {
    'Content-Type': 'application/json',
    ...authAdapter.getAuthHeaders(),
  }
}

export default function SystemDashboardPage() {
  const { authAdapter } = useDashboardContext()
  const [data, setData] = useState<SystemDashboardData | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadDashboard = useCallback(async () => {
    setError(null)
    const res = await window.fetch('/api/cart-tracking/admin-system-dashboard', {
      headers: authHeaders(authAdapter),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new MantaError('UNEXPECTED_STATE', body.message ?? 'Impossible de charger le dashboard')
    }
    const body = (await res.json()) as { data?: SystemDashboardData }
    if (!body.data) throw new MantaError('UNEXPECTED_STATE', 'Réponse dashboard invalide')
    setData(body.data)
  }, [authAdapter])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        await loadDashboard()
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void run()
    const interval = window.setInterval(() => void run(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [loadDashboard])

  if (isLoading) return <LoadingState />
  if (error) {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-normal">Dashboard</h1>
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Impossible de charger le dashboard: {error.message}
        </div>
      </div>
    )
  }
  if (!data) return null

  const status = statusCopy[data.status]
  const auditRun = data.meta.audit_run
  const criticalCount = data.findings.filter((finding) => finding.severity === 'critical').length
  const warningCount = data.findings.filter((finding) => finding.severity === 'warning').length

  return (
    <div className="flex flex-col gap-5 pb-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-normal">Dashboard</h1>
            <span className={`inline-flex h-7 items-center gap-2 rounded-md border px-2.5 text-sm ${status.className}`}>
              <span className={`size-2 rounded-full ${status.dot}`} />
              {status.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Dernier audit {auditRun?.finished_at ? formatDateTime(auditRun.finished_at) : 'non disponible'} · Données
            live {formatDateTime(data.meta.generated_at)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void loadDashboard().catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
          }}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <RefreshCw className="size-4" />
          Rafraîchir
        </button>
      </div>

      {auditRun?.status === 'failed' ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Audit échoué: {auditRun.error_message ?? 'erreur inconnue'}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Paniers 30j"
            value={fmtNumber(data.business.carts_30d)}
            detail={`${fmtNumber(data.business.active_carts_30d)} actifs`}
          />
          <MetricCard
            label="Conversion paniers"
            value={fmtNumber(data.business.completed_30d)}
            detail="paniers complétés 30j"
          />
          <MetricCard
            label="Identification"
            value={fmtPercent(data.business.identified_event_rate_24h)}
            detail={`${fmtNumber(data.business.events_24h)} events 24h`}
          />
          <MetricCard
            label="Recovery"
            value={fmtCurrency(data.business.recovered_revenue_30d)}
            detail={`${fmtPercent(data.business.recovery_rate_30d)} · ${fmtNumber(data.business.recovered_cases_30d)} récupérés`}
          />
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Activity className="size-4" />
              Synthèse audit
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted-foreground">Findings critiques</span>
              <span className="text-2xl font-semibold">{criticalCount}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted-foreground">Warnings</span>
              <span className="text-2xl font-semibold">{warningCount}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock3 className="size-3.5" />
              {auditRun
                ? `${auditRun.trigger === 'nightly' ? 'Nocturne' : 'Manuel'} · ${auditRun.status}`
                : 'Aucun run'}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        {data.health.map((item) => (
          <HealthCard key={item.key} item={item} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <FindingsTable findings={data.findings} />
        <AuditList audits={data.audits} />
      </section>
    </div>
  )
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function HealthCard({ item }: { item: SystemDashboardData['health'][number] }) {
  const Icon = item.status === 'ok' ? CheckCircle2 : item.status === 'critical' ? XCircle : AlertTriangle
  const status = statusCopy[item.status]
  return (
    <Link
      to={item.href}
      className="rounded-md border bg-card p-4 transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="size-4 shrink-0" />
            <h2 className="truncate text-sm font-semibold">{item.label}</h2>
          </div>
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{item.summary}</p>
        </div>
        <span className={`size-2.5 shrink-0 rounded-full ${status.dot}`} />
      </div>
      <div className="mt-3 space-y-1">
        {item.details.slice(0, 2).map((detail) => (
          <p key={detail} className="truncate text-xs text-muted-foreground">
            {detail}
          </p>
        ))}
      </div>
    </Link>
  )
}

function FindingsTable({ findings }: { findings: SystemDashboardData['findings'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4" />
          Findings
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {findings.length === 0 ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            Aucun finding sur le dernier audit.
          </div>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-medium">Sévérité</th>
                <th className="py-2 pr-4 font-medium">Finding</th>
                <th className="py-2 pr-4 font-medium">Source</th>
                <th className="py-2 pr-4 text-right font-medium">Count</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {findings.map((finding) => (
                <tr key={finding.id} className="border-b last:border-0">
                  <td className="py-3 pr-4">
                    <SeverityBadge severity={finding.severity} />
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{finding.title}</div>
                    <div className="mt-1 max-w-xl text-xs text-muted-foreground">{finding.summary}</div>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">{sourceLabel(finding.source)}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{fmtNumber(finding.count)}</td>
                  <td className="py-3">
                    <Link className="inline-flex items-center gap-1 text-primary hover:underline" to={finding.href}>
                      Ouvrir
                      <ExternalLink className="size-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

function AuditList({ audits }: { audits: SystemDashboardData['audits'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="size-4" />
          Audits
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {audits.map((audit) => (
          <Link
            key={audit.key}
            to={audit.href}
            className="flex items-center justify-between gap-3 rounded-md border p-3"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{audit.label}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {audit.last_run_at ? formatDateTime(audit.last_run_at) : 'Jamais lancé'}
              </div>
            </div>
            <AuditBadge status={audit.status} />
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

function SeverityBadge({ severity }: { severity: SystemDashboardData['findings'][number]['severity'] }) {
  if (severity === 'critical') return <Badge className="border-red-200 bg-red-50 text-red-800">Critique</Badge>
  if (severity === 'warning') return <Badge className="border-amber-200 bg-amber-50 text-amber-800">Warning</Badge>
  return <Badge variant="outline">Info</Badge>
}

function AuditBadge({ status }: { status: SystemDashboardData['audits'][number]['status'] }) {
  if (status === 'passing') return <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800">Passing</Badge>
  if (status === 'failing') return <Badge className="border-red-200 bg-red-50 text-red-800">Failing</Badge>
  return <Badge variant="outline">Unknown</Badge>
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {['metric-carts', 'metric-conversion', 'metric-identity', 'metric-recovery'].map((key) => (
          <Skeleton key={key} className="h-32 rounded-md" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-md" />
    </div>
  )
}

function fmtNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR').format(value)
}

function fmtPercent(value: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 }).format(value)
}

function fmtCurrency(value: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function sourceLabel(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
