import { useQuery } from '@mantajs/sdk'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChartContainer,
  DateRangePicker,
  type DateRangeValue,
  parseRange,
  resolveRange,
  Skeleton,
  serializeRange,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@mantajs/ui'
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'

type ViewMode = 'overview' | 'emails' | 'checks'

interface DashboardData {
  meta: { range: { from: string; to: string }; generated_at: string }
  kpis: {
    cases_opened: number
    open_cases_total: number
    recovered_cases: number
    sent_messages: number
    skipped_messages: number
    failed_messages: number
    due_pending: number
    recovered_from_sent_messages: number
    recovery_rate: number
    recovered_revenue: number
    shopify_blocks: number
    optout_blocks: number
    klaviyo_blocks: number
  }
  by_type: TypeRow[]
  skip_reasons: Array<{ skip_reason: string; count: number }>
  daily: DailyRow[]
  cases: CaseItem[]
  messages: MessageItem[]
  checks: CheckItem[]
}

interface TypeRow {
  message_type: string
  sent: number
  skipped: number
  pending: number
  failed: number
  recovered: number
  recovery_rate: number
  recovered_revenue: number
}

interface DailyRow {
  date: string
  cases_opened: number
  sent: number
  skipped: number
  failed: number
  recovered: number
  recovered_revenue: number
  abandoned_cart_1: number
  abandoned_cart_2: number
  abandoned_cart_3: number
  payment_help_1: number
}

interface CaseItem {
  id: string
  cart_id: string
  email: string
  case_type: string
  status: string
  stage_at_open: string | null
  opened_at: string
  last_cart_action_at: string
  last_activity_at: string
  email_1: string | null
  email_2: string | null
  email_3: string | null
  payment_help: string | null
  messages_sent: number
  last_sent_at: string | null
  next_due_at: string | null
  recovered_at: string | null
  recovered_amount: number
  recovered_by_message_type: string | null
  checks_blocked: number
  checks_error: number
}

interface MessageItem {
  id: string
  case_id: string
  cart_id: string
  email: string
  case_type: string | null
  stage_at_open: string | null
  message_type: string
  status: string
  scheduled_for: string
  sent_at: string | null
  activity_at: string
  provider: string | null
  provider_message_id: string | null
  locale: string | null
  subject: string | null
  snapshot_html_url: string | null
  snapshot_error: string | null
  skip_reason: string | null
  error_message: string | null
  recovered: boolean
  recovered_amount: number
}

interface CheckItem {
  id: string
  case_id: string
  message_id: string | null
  email: string | null
  case_type: string | null
  message_type: string | null
  check_type: string
  status: string
  checked_at: string
  raw_summary: string | null
}

const DEFAULT_RANGE: DateRangeValue = { kind: 'preset', preset: '30d' }
const headerGridStyle = { gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }
const chartGridStyle = { gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }
const tabsGridStyle = { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', width: 'min(100%, 30rem)' }

const MESSAGE_LABELS: Record<string, string> = {
  abandoned_cart_1: 'Email 1',
  abandoned_cart_2: 'Email 2',
  abandoned_cart_3: 'Email 3',
  payment_help_1: 'Payment help',
  klaviyo_abandoned: 'Klaviyo',
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Ouvert',
  recovered: 'Recovered',
  closed_order_found: 'Commande trouvée',
  closed_unsubscribed: 'Unsubscribed',
  expired: 'Expiré',
  pending: 'Prévu',
  sent: 'Envoyé',
  skipped: 'Skippé',
  failed: 'Erreur',
}

export function AbandonedCartCampaignView({ mode }: { mode: ViewMode }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState('all')
  const range = React.useMemo(() => parseRange(searchParams.get('range')) ?? DEFAULT_RANGE, [searchParams])
  const resolved = React.useMemo(() => resolveRange(range), [range])
  const params = React.useMemo(
    () => ({
      from: resolved.from.toISOString(),
      to: resolved.to.toISOString(),
      limit: 500,
    }),
    [resolved.from, resolved.to],
  )
  const query = useQuery<DashboardData>('abandoned-cart-campaign-dashboard', params, { staleTime: 60_000 })
  const data = query.data

  const updateRange = (next: DateRangeValue) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('range', serializeRange(next))
    setSearchParams(nextParams)
  }

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-normal">{titleForMode(mode)}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">
              {formatDate(params.from)} - {formatDate(params.to)}
            </Badge>
            {data ? <span>Mis à jour {formatDateTime(data.meta.generated_at)}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={updateRange} allowedPresets={['7d', '30d', '90d']} />
          <Button variant="outline" size="small" onClick={() => query.refetch()} isLoading={query.isFetching}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      <Subnav active={mode} />

      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={query.error.message} /> : null}
      {data ? (
        <>
          <KpiGrid data={data} />
          {mode === 'overview' ? (
            <Overview data={data} search={search} setSearch={setSearch} status={status} setStatus={setStatus} />
          ) : null}
          {mode === 'emails' ? (
            <EmailsView data={data} search={search} setSearch={setSearch} status={status} setStatus={setStatus} />
          ) : null}
          {mode === 'checks' ? (
            <ChecksView data={data} search={search} setSearch={setSearch} status={status} setStatus={setStatus} />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function Subnav({ active }: { active: ViewMode }) {
  const links: Array<{ mode: ViewMode; to: string; label: string }> = [
    { mode: 'overview', to: '/paniers-abandonnes', label: 'Vue globale' },
    { mode: 'emails', to: '/paniers-abandonnes/emails', label: 'Emails' },
    { mode: 'checks', to: '/paniers-abandonnes/checks', label: 'Checks' },
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <Button key={link.to} asChild variant={active === link.mode ? 'default' : 'outline'} size="small">
          <Link to={link.to}>{link.label}</Link>
        </Button>
      ))}
    </div>
  )
}

function KpiGrid({ data }: { data: DashboardData }) {
  const cards = [
    {
      label: 'Dossiers ouverts',
      value: fmtNumber(data.kpis.cases_opened),
      detail: `${fmtNumber(data.kpis.open_cases_total)} ouverts au total`,
      icon: ShoppingCart,
    },
    {
      label: 'Emails envoyés',
      value: fmtNumber(data.kpis.sent_messages),
      detail: `${fmtNumber(data.kpis.skipped_messages)} skippés · ${fmtNumber(data.kpis.failed_messages)} erreurs`,
      icon: Mail,
    },
    {
      label: 'Recovery',
      value: fmtPct(data.kpis.recovery_rate),
      detail: `${fmtNumber(data.kpis.recovered_from_sent_messages)} recoveries attribuées`,
      icon: CheckCircle2,
    },
    {
      label: 'CA recoveré',
      value: fmtMoney(data.kpis.recovered_revenue),
      detail: `${fmtNumber(data.kpis.recovered_cases)} commandes`,
      icon: CircleDollarSign,
    },
    {
      label: 'Garde-fous',
      value: fmtNumber(data.kpis.shopify_blocks),
      detail: `Shopify · ${fmtNumber(data.kpis.optout_blocks)} opt-out · ${fmtNumber(data.kpis.klaviyo_blocks)} Klaviyo`,
      icon: ShieldCheck,
    },
    {
      label: 'À envoyer',
      value: fmtNumber(data.kpis.due_pending),
      detail: 'messages pending déjà dus',
      icon: Clock,
    },
  ]
  return (
    <div className="grid gap-3" style={headerGridStyle}>
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <Card key={card.label} className="border border-border/70 shadow-none">
            <CardContent className="flex items-start gap-3 p-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-muted-foreground">{card.label}</div>
                <div className="mt-0.5 truncate text-2xl font-semibold tracking-normal">{card.value}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{card.detail}</div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function Overview({
  data,
  search,
  setSearch,
  status,
  setStatus,
}: {
  data: DashboardData
  search: string
  setSearch: (value: string) => void
  status: string
  setStatus: (value: string) => void
}) {
  return (
    <>
      <div className="grid gap-4" style={chartGridStyle}>
        <DailyChart rows={data.daily} />
        <RevenueChart rows={data.daily} />
      </div>
      <Tabs defaultValue="by-email" className="w-full">
        <TabsList className="grid w-full" style={tabsGridStyle}>
          <TabsTrigger value="by-email">Par email</TabsTrigger>
          <TabsTrigger value="skips">Skips</TabsTrigger>
          <TabsTrigger value="cases">Dossiers</TabsTrigger>
        </TabsList>
        <TabsContent value="by-email" className="mt-4">
          <ByTypeTable rows={data.by_type} />
        </TabsContent>
        <TabsContent value="skips" className="mt-4">
          <SkipTable rows={data.skip_reasons} />
        </TabsContent>
        <TabsContent value="cases" className="mt-4">
          <Toolbar
            search={search}
            setSearch={setSearch}
            status={status}
            setStatus={setStatus}
            statusOptions={caseStatusOptions(data.cases)}
          />
          <CasesTable rows={filterCases(data.cases, search, status)} />
        </TabsContent>
      </Tabs>
    </>
  )
}

function EmailsView({
  data,
  search,
  setSearch,
  status,
  setStatus,
}: {
  data: DashboardData
  search: string
  setSearch: (value: string) => void
  status: string
  setStatus: (value: string) => void
}) {
  return (
    <>
      <ByTypeTable rows={data.by_type} />
      <Toolbar
        search={search}
        setSearch={setSearch}
        status={status}
        setStatus={setStatus}
        statusOptions={messageStatusOptions(data.messages)}
      />
      <MessagesTable rows={filterMessages(data.messages, search, status)} />
    </>
  )
}

function ChecksView({
  data,
  search,
  setSearch,
  status,
  setStatus,
}: {
  data: DashboardData
  search: string
  setSearch: (value: string) => void
  status: string
  setStatus: (value: string) => void
}) {
  return (
    <>
      <GuardSummary data={data} />
      <Toolbar
        search={search}
        setSearch={setSearch}
        status={status}
        setStatus={setStatus}
        statusOptions={checkStatusOptions(data.checks)}
      />
      <ChecksTable rows={filterChecks(data.checks, search, status)} />
    </>
  )
}

function DailyChart({ rows }: { rows: DailyRow[] }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle>Emails et recoveries</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          className="h-[260px]"
          config={{
            sent: { label: 'Envoyés', color: 'var(--chart-1)' },
            recovered: { label: 'Recoveries', color: 'var(--chart-3)' },
            skipped: { label: 'Skippés', color: 'var(--chart-5)' },
          }}
        >
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={shortDate} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <Tooltip formatter={formatTooltipNumber} />
            <Line type="monotone" dataKey="sent" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="skipped" stroke="var(--chart-5)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="recovered" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function RevenueChart({ rows }: { rows: DailyRow[] }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle>CA recoveré</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer className="h-[260px]" config={{ recovered_revenue: { label: 'CA', color: 'var(--chart-4)' } }}>
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={shortDate} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <Tooltip formatter={formatTooltipMoney} />
            <Bar dataKey="recovered_revenue" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function ByTypeTable({ rows }: { rows: TypeRow[] }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle>Performance par email</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Email</th>
              <th className="py-2 pr-3 text-right font-medium">Envoyés</th>
              <th className="py-2 pr-3 text-right font-medium">Skippés</th>
              <th className="py-2 pr-3 text-right font-medium">Pending</th>
              <th className="py-2 pr-3 text-right font-medium">Recoveries</th>
              <th className="py-2 pr-3 text-right font-medium">Taux</th>
              <th className="py-2 text-right font-medium">CA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.message_type} className="border-b last:border-0">
                <td className="py-3 pr-3 font-medium">{messageLabel(row.message_type)}</td>
                <td className="py-3 pr-3 text-right">{fmtNumber(row.sent)}</td>
                <td className="py-3 pr-3 text-right">{fmtNumber(row.skipped)}</td>
                <td className="py-3 pr-3 text-right">{fmtNumber(row.pending)}</td>
                <td className="py-3 pr-3 text-right">{fmtNumber(row.recovered)}</td>
                <td className="py-3 pr-3 text-right">{fmtPct(row.recovery_rate)}</td>
                <td className="py-3 text-right">{fmtMoney(row.recovered_revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function SkipTable({ rows }: { rows: Array<{ skip_reason: string; count: number }> }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle>Raisons de skip</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? <div className="text-sm text-muted-foreground">Aucun skip sur cette fenêtre.</div> : null}
        {rows.map((row) => (
          <div key={row.skip_reason} className="flex items-center justify-between rounded-md border p-3 text-sm">
            <span>{humanize(row.skip_reason)}</span>
            <Badge variant="outline">{fmtNumber(row.count)}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function GuardSummary({ data }: { data: DashboardData }) {
  const rows = [
    { label: 'Commandes Shopify trouvées', value: data.kpis.shopify_blocks, icon: ShieldCheck },
    { label: 'Opt-out / suppressed', value: data.kpis.optout_blocks, icon: AlertTriangle },
    { label: 'Klaviyo déjà envoyé', value: data.kpis.klaviyo_blocks, icon: Mail },
  ]
  return (
    <div className="grid gap-3" style={headerGridStyle}>
      {rows.map((row) => {
        const Icon = row.icon
        return (
          <Card key={row.label} className="border border-border/70 shadow-none">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <div className="text-sm font-medium">{row.label}</div>
                <div className="text-xs text-muted-foreground">Bloqués avant envoi</div>
              </div>
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-2xl font-semibold">{fmtNumber(row.value)}</span>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function Toolbar({
  search,
  setSearch,
  status,
  setStatus,
  statusOptions,
}: {
  search: string
  setSearch: (value: string) => void
  status: string
  setStatus: (value: string) => void
  statusOptions: string[]
}) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div className="relative w-full md:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search email, statut, message..."
          className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:border-foreground/40"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {['all', ...statusOptions].map((option) => (
          <Button
            key={option}
            variant={status === option ? 'default' : 'outline'}
            size="small"
            onClick={() => setStatus(option)}
          >
            {option === 'all' ? 'Tous' : humanize(option)}
          </Button>
        ))}
      </div>
    </div>
  )
}

function CasesTable({ rows }: { rows: CaseItem[] }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle>Dossiers de recovery</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[1320px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Client</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Statut</th>
              <th className="py-2 pr-3 font-medium">Stage</th>
              <th className="py-2 pr-3 font-medium">Email 1</th>
              <th className="py-2 pr-3 font-medium">Email 2</th>
              <th className="py-2 pr-3 font-medium">Email 3</th>
              <th className="py-2 pr-3 font-medium">Payment</th>
              <th className="py-2 pr-3 text-right font-medium">Envoyés</th>
              <th className="py-2 pr-3 font-medium">Dernier envoi</th>
              <th className="py-2 pr-3 font-medium">Prochain dû</th>
              <th className="py-2 pr-3 font-medium">Recovery</th>
              <th className="py-2 text-right font-medium">CA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="py-3 pr-3 font-medium">
                  <Link to={`/paniers/${row.cart_id}`} className="hover:underline">
                    {row.email}
                  </Link>
                </td>
                <td className="py-3 pr-3">
                  <Badge variant="outline">{humanize(row.case_type)}</Badge>
                </td>
                <td className="py-3 pr-3">
                  <StatusBadge value={row.status} />
                </td>
                <td className="py-3 pr-3 text-muted-foreground">{humanize(row.stage_at_open ?? '-')}</td>
                <td className="py-3 pr-3">
                  <MessageState value={row.email_1} />
                </td>
                <td className="py-3 pr-3">
                  <MessageState value={row.email_2} />
                </td>
                <td className="py-3 pr-3">
                  <MessageState value={row.email_3} />
                </td>
                <td className="py-3 pr-3">
                  <MessageState value={row.payment_help} />
                </td>
                <td className="py-3 pr-3 text-right">{fmtNumber(row.messages_sent)}</td>
                <td className="py-3 pr-3">{row.last_sent_at ? formatDateTime(row.last_sent_at) : '-'}</td>
                <td className="py-3 pr-3">{row.next_due_at ? formatDateTime(row.next_due_at) : '-'}</td>
                <td className="py-3 pr-3">
                  {row.recovered_at
                    ? `${formatDateTime(row.recovered_at)} · ${messageLabel(row.recovered_by_message_type ?? '')}`
                    : '-'}
                </td>
                <td className="py-3 text-right">{row.recovered_amount > 0 ? fmtMoney(row.recovered_amount) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function MessagesTable({ rows }: { rows: MessageItem[] }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle>Emails envoyés, prévus et skippés</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[1340px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Client</th>
              <th className="py-2 pr-3 font-medium">Email</th>
              <th className="py-2 pr-3 font-medium">Statut</th>
              <th className="py-2 pr-3 font-medium">Type dossier</th>
              <th className="py-2 pr-3 font-medium">Prévu</th>
              <th className="py-2 pr-3 font-medium">Envoyé</th>
              <th className="py-2 pr-3 font-medium">Snapshot</th>
              <th className="py-2 pr-3 font-medium">Skip / erreur</th>
              <th className="py-2 pr-3 font-medium">Recovery</th>
              <th className="py-2 pr-3 font-medium">Sujet</th>
              <th className="py-2 text-right font-medium">CA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="py-3 pr-3 font-medium">
                  <Link to={`/paniers/${row.cart_id}`} className="hover:underline">
                    {row.email}
                  </Link>
                </td>
                <td className="py-3 pr-3">
                  <Link to={`/emails/${row.id}`} className="hover:underline">
                    <Badge variant="outline">{messageLabel(row.message_type)}</Badge>
                  </Link>
                </td>
                <td className="py-3 pr-3">
                  <StatusBadge value={row.status} />
                </td>
                <td className="py-3 pr-3 text-muted-foreground">{humanize(row.case_type ?? '-')}</td>
                <td className="py-3 pr-3">{formatDateTime(row.scheduled_for)}</td>
                <td className="py-3 pr-3">{row.sent_at ? formatDateTime(row.sent_at) : '-'}</td>
                <td className="py-3 pr-3">
                  {row.snapshot_html_url ? (
                    <Badge variant="green">Snapshot</Badge>
                  ) : row.snapshot_error ? (
                    <Badge variant="orange">Snapshot err</Badge>
                  ) : (
                    <Badge variant="outline">Reconstr.</Badge>
                  )}
                </td>
                <td className="max-w-[260px] truncate py-3 pr-3 text-muted-foreground">
                  {humanize(row.skip_reason ?? row.error_message ?? '-')}
                </td>
                <td className="py-3 pr-3">{row.recovered ? <Badge variant="green">Recovered</Badge> : '-'}</td>
                <td className="max-w-[280px] truncate py-3 pr-3">
                  <Link to={`/emails/${row.id}`} className="hover:underline">
                    {row.subject ?? '-'}
                  </Link>
                </td>
                <td className="py-3 text-right">{row.recovered_amount > 0 ? fmtMoney(row.recovered_amount) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function ChecksTable({ rows }: { rows: CheckItem[] }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle>Garde-fous exécutés</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Client</th>
              <th className="py-2 pr-3 font-medium">Check</th>
              <th className="py-2 pr-3 font-medium">Résultat</th>
              <th className="py-2 pr-3 font-medium">Email</th>
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="py-2 font-medium">Détail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="py-3 pr-3 font-medium">{row.email ?? '-'}</td>
                <td className="py-3 pr-3">{humanize(row.check_type)}</td>
                <td className="py-3 pr-3">
                  <StatusBadge value={row.status} />
                </td>
                <td className="py-3 pr-3 text-muted-foreground">
                  {row.message_type ? messageLabel(row.message_type) : '-'}
                </td>
                <td className="py-3 pr-3">{formatDateTime(row.checked_at)}</td>
                <td className="max-w-[420px] truncate py-3">{row.raw_summary ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function StatusBadge({ value }: { value: string }) {
  const variant =
    value === 'sent' || value === 'recovered' || value === 'passed'
      ? 'green'
      : value === 'failed' || value === 'error' || value === 'blocked'
        ? 'orange'
        : 'outline'
  return <Badge variant={variant}>{STATUS_LABELS[value] ?? humanize(value)}</Badge>
}

function MessageState({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">-</span>
  if (value.startsWith('skipped:'))
    return <Badge variant="orange">{humanize(value.replace('skipped:', 'skip '))}</Badge>
  return <StatusBadge value={value} />
}

function LoadingState() {
  const placeholders = ['kpi-1', 'kpi-2', 'kpi-3', 'kpi-4', 'kpi-5', 'kpi-6']
  return (
    <div className="grid gap-3" style={headerGridStyle}>
      {placeholders.map((key) => (
        <Skeleton key={key} className="h-28 rounded-md" />
      ))}
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">{message}</div>
}

function filterCases(rows: CaseItem[], search: string, status: string): CaseItem[] {
  return rows.filter((row) => {
    if (status !== 'all' && row.status !== status && row.case_type !== status) return false
    return searchable(row, search)
  })
}

function filterMessages(rows: MessageItem[], search: string, status: string): MessageItem[] {
  return rows.filter((row) => {
    if (status !== 'all' && row.status !== status && row.message_type !== status && row.skip_reason !== status)
      return false
    return searchable(row, search)
  })
}

function filterChecks(rows: CheckItem[], search: string, status: string): CheckItem[] {
  return rows.filter((row) => {
    if (status !== 'all' && row.status !== status && row.check_type !== status) return false
    return searchable(row, search)
  })
}

function searchable(row: unknown, search: string): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return true
  return JSON.stringify(row).toLowerCase().includes(q)
}

function caseStatusOptions(rows: CaseItem[]) {
  return unique([...rows.map((row) => row.status), ...rows.map((row) => row.case_type)])
}

function messageStatusOptions(rows: MessageItem[]) {
  return unique([
    ...rows.map((row) => row.status),
    ...rows.map((row) => row.message_type),
    ...(rows.map((row) => row.skip_reason).filter(Boolean) as string[]),
  ])
}

function checkStatusOptions(rows: CheckItem[]) {
  return unique([...rows.map((row) => row.status), ...rows.map((row) => row.check_type)])
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).slice(0, 8)
}

function titleForMode(mode: ViewMode): string {
  if (mode === 'emails') return 'Relances paniers abandonnés'
  if (mode === 'checks') return 'Checks paniers abandonnés'
  return 'Paniers abandonnés'
}

function messageLabel(value: string): string {
  return MESSAGE_LABELS[value] ?? humanize(value)
}

function humanize(value: string): string {
  if (!value || value === '-') return '-'
  return value
    .replace(/^skip /, 'Skip ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatTooltipNumber(value: unknown, name: unknown) {
  return [fmtNumber(Number(value)), humanize(String(name))]
}

function formatTooltipMoney(value: unknown, name: unknown) {
  return [fmtMoney(Number(value)), humanize(String(name))]
}

function fmtNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR').format(Math.round(value))
}

function fmtMoney(value: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)
}

function fmtPct(value: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)} %`
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' }).format(date)
}
