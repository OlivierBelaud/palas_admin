import { useQuery } from '@manta/sdk'
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
  Progress,
  parseRange,
  resolveRange,
  Skeleton,
  serializeRange,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@manta/ui'
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  MousePointerClick,
  RefreshCw,
  ShoppingCart,
  UserCheck,
  Users,
} from 'lucide-react'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'

type Segment = 'unknown' | 'known_no_purchase' | 'returning_customer'

interface Kpis {
  sessions: number
  orders: number
  revenue: number
  aov: number
  converted_sessions: number
  conversion_rate: number
  became_known: number
  became_known_rate: number
  became_customer: number
  became_customer_rate: number
  cart_viewed_sessions: number
  cart_view_rate: number
  cart_initiated_sessions: number
  cart_initiation_rate: number
  cart_updated_sessions: number
  cart_update_rate: number
}

interface AudienceRow {
  key: Segment
  label: string
  sessions: number
  share: number
  cart_viewed_sessions: number
  cart_view_rate: number
  cart_initiated_sessions: number
  cart_initiation_rate: number
  cart_updated_sessions: number
  cart_update_rate: number
  converted_sessions: number
  conversion_rate: number
  became_known: number
  became_customer: number
  orders: number
  revenue: number
  aov: number
}

interface DailyRow {
  date: string
  sessions: number
  unknown: number
  known_no_purchase: number
  returning_customer: number
  became_known: number
  became_customer: number
  converted_sessions: number
  orders: number
  revenue: number
  conversion_rate: number
}

interface FlowRow {
  from: string
  to: string
  value: number
}

interface DataQuality {
  sessions_without_contact_but_known_segment: number
  converted_sessions_without_order_id: number
  converted_sessions_without_matching_order: number
  became_customer_sessions_without_contact: number
  known_transitions: number
}

interface LifecycleDashboardData {
  meta: { range: { from: string; to: string }; generated_at: string }
  kpis: Kpis
  audience: AudienceRow[]
  daily: DailyRow[]
  flow: FlowRow[]
  data_quality: DataQuality
}

const AUDIENCE_COLORS: Record<Segment, string> = {
  unknown: 'var(--chart-1)',
  known_no_purchase: 'var(--chart-2)',
  returning_customer: 'var(--chart-3)',
}

const DEFAULT_RANGE: DateRangeValue = { kind: 'preset', preset: '30d' }

export default function VisitorLifecyclePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const range = React.useMemo(() => parseRange(searchParams.get('range')) ?? DEFAULT_RANGE, [searchParams])
  const resolved = React.useMemo(() => resolveRange(range), [range])
  const params = React.useMemo(
    () => ({
      from: resolved.from.toISOString(),
      to: resolved.to.toISOString(),
    }),
    [resolved.from, resolved.to],
  )
  const query = useQuery<LifecycleDashboardData>('visitor-lifecycle-dashboard', params, {
    staleTime: 60_000,
  })
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
          <h1 className="text-2xl font-semibold tracking-normal">Visitor lifecycle</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">
              {formatDate(params.from)} - {formatDate(params.to)}
            </Badge>
            {data ? <span>Mis à jour {formatDateTime(data.meta.generated_at)}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker value={range} onChange={updateRange} allowedPresets={['7d', '30d', '90d']} />
          <Button variant="outline" size="small" onClick={() => query.refetch()} isLoading={query.isFetching}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={query.error.message} /> : null}
      {data ? <Dashboard data={data} /> : null}
    </div>
  )
}

function Dashboard({ data }: { data: LifecycleDashboardData }) {
  return (
    <>
      <KpiGrid kpis={data.kpis} />
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-4 md:w-[36rem]">
          <TabsTrigger value="overview">Vue</TabsTrigger>
          <TabsTrigger value="audiences">Audiences</TabsTrigger>
          <TabsTrigger value="trends">Temps</TabsTrigger>
          <TabsTrigger value="quality">Qualité</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <LifecycleFlow rows={data.flow} />
            <ConversionRates audience={data.audience} />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <AudienceMixChart rows={data.audience} />
            <DailyTransitionsChart rows={data.daily} />
          </div>
        </TabsContent>

        <TabsContent value="audiences" className="mt-4">
          <AudienceMatrix rows={data.audience} />
        </TabsContent>

        <TabsContent value="trends" className="mt-4">
          <div className="grid gap-4">
            <SessionsByAudienceChart rows={data.daily} />
            <DailyRevenueConversionChart rows={data.daily} />
          </div>
        </TabsContent>

        <TabsContent value="quality" className="mt-4">
          <DataQualityPanel quality={data.data_quality} />
        </TabsContent>
      </Tabs>
    </>
  )
}

function KpiGrid({ kpis }: { kpis: Kpis }) {
  const cards = [
    {
      label: 'Sessions',
      value: fmtNumber(kpis.sessions),
      icon: Users,
      sub: `${fmtPct(kpis.conversion_rate)} conversion`,
    },
    {
      label: 'CA ecommerce',
      value: fmtMoney(kpis.revenue),
      icon: CircleDollarSign,
      sub: `${fmtNumber(kpis.orders)} orders`,
    },
    {
      label: 'Deviennent connus',
      value: fmtNumber(kpis.became_known),
      icon: UserCheck,
      sub: fmtPct(kpis.became_known_rate),
    },
    {
      label: 'Deviennent clients',
      value: fmtNumber(kpis.became_customer),
      icon: CheckCircle2,
      sub: fmtPct(kpis.became_customer_rate),
    },
    { label: 'Vues panier', value: fmtNumber(kpis.cart_viewed_sessions), icon: Eye, sub: fmtPct(kpis.cart_view_rate) },
    {
      label: 'Paniers initiés',
      value: fmtNumber(kpis.cart_initiated_sessions),
      icon: ShoppingCart,
      sub: fmtPct(kpis.cart_initiation_rate),
    },
    {
      label: 'Paniers modifiés',
      value: fmtNumber(kpis.cart_updated_sessions),
      icon: MousePointerClick,
      sub: fmtPct(kpis.cart_update_rate),
    },
    {
      label: 'Panier moyen',
      value: fmtMoney(kpis.aov),
      icon: Activity,
      sub: `${fmtNumber(kpis.converted_sessions)} sessions converties`,
    },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <Card key={card.label} className="border border-border/70 shadow-none">
            <CardContent className="flex items-center justify-between p-4">
              <div className="min-w-0">
                <div className="text-xs font-medium text-muted-foreground">{card.label}</div>
                <div className="mt-1 text-2xl font-semibold tracking-normal">{card.value}</div>
                <div className="mt-1 text-xs text-muted-foreground">{card.sub}</div>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function LifecycleFlow({ rows }: { rows: FlowRow[] }) {
  const max = Math.max(...rows.map((row) => row.value), 1)
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle>Transitions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => (
          <div key={`${row.from}-${row.to}`} className="grid grid-cols-[1fr_auto_1fr_5rem] items-center gap-3">
            <div className="truncate text-sm font-medium">{row.from}</div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate text-sm">{row.to}</div>
              <Progress className="mt-1 h-1.5" value={(row.value / max) * 100} />
            </div>
            <div className="text-right text-sm font-semibold">{fmtNumber(row.value)}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function ConversionRates({ audience }: { audience: AudienceRow[] }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle>Taux par audience</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {audience.map((row) => (
          <div key={row.key}>
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{row.label}</span>
              <span className="text-muted-foreground">{fmtPct(row.conversion_rate)}</span>
            </div>
            <Progress value={row.conversion_rate} className="h-2" />
            <div className="mt-1 text-xs text-muted-foreground">
              {fmtNumber(row.converted_sessions)} / {fmtNumber(row.sessions)} sessions
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function AudienceMixChart({ rows }: { rows: AudienceRow[] }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle>Répartition audience</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          className="h-[280px]"
          config={{
            sessions: { label: 'Sessions', color: 'var(--chart-1)' },
          }}
        >
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value) => fmtNumber(Number(value))} />
            <Bar dataKey="sessions" radius={[4, 4, 0, 0]}>
              {rows.map((row) => (
                <Cell key={row.key} fill={AUDIENCE_COLORS[row.key]} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function DailyTransitionsChart({ rows }: { rows: DailyRow[] }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle>Transitions par jour</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          className="h-[280px]"
          config={{
            became_known: { label: 'Deviennent connus', color: 'var(--chart-2)' },
            became_customer: { label: 'Deviennent clients', color: 'var(--chart-3)' },
          }}
        >
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value) => fmtNumber(Number(value))} />
            <Line type="monotone" dataKey="became_known" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="became_customer" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function AudienceMatrix({ rows }: { rows: AudienceRow[] }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle>Matrice lifecycle</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Audience départ</th>
              <th className="py-2 pr-3 text-right font-medium">Sessions</th>
              <th className="py-2 pr-3 text-right font-medium">Vue panier</th>
              <th className="py-2 pr-3 text-right font-medium">Panier initié</th>
              <th className="py-2 pr-3 text-right font-medium">Panier modifié</th>
              <th className="py-2 pr-3 text-right font-medium">Convertis</th>
              <th className="py-2 pr-3 text-right font-medium">Devient connu</th>
              <th className="py-2 pr-3 text-right font-medium">Devient client</th>
              <th className="py-2 pr-3 text-right font-medium">CA</th>
              <th className="py-2 text-right font-medium">AOV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b last:border-0">
                <td className="py-3 pr-3">
                  <div className="font-medium">{row.label}</div>
                  <div className="text-xs text-muted-foreground">{fmtPct(row.share)} des sessions</div>
                </td>
                <td className="py-3 pr-3 text-right">{fmtNumber(row.sessions)}</td>
                <MetricCell count={row.cart_viewed_sessions} rate={row.cart_view_rate} />
                <MetricCell count={row.cart_initiated_sessions} rate={row.cart_initiation_rate} />
                <MetricCell count={row.cart_updated_sessions} rate={row.cart_update_rate} />
                <MetricCell count={row.converted_sessions} rate={row.conversion_rate} />
                <td className="py-3 pr-3 text-right">{fmtNumber(row.became_known)}</td>
                <td className="py-3 pr-3 text-right">{fmtNumber(row.became_customer)}</td>
                <td className="py-3 pr-3 text-right">{fmtMoney(row.revenue)}</td>
                <td className="py-3 text-right">{fmtMoney(row.aov)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function SessionsByAudienceChart({ rows }: { rows: DailyRow[] }) {
  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle>Sessions par audience</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          className="h-[320px]"
          config={{
            unknown: { label: 'Inconnus', color: 'var(--chart-1)' },
            known_no_purchase: { label: 'Connus non-clients', color: 'var(--chart-2)' },
            returning_customer: { label: 'Clients existants', color: 'var(--chart-3)' },
          }}
        >
          <AreaChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value) => fmtNumber(Number(value))} />
            <Area type="monotone" dataKey="unknown" stackId="1" fill="var(--chart-1)" stroke="var(--chart-1)" />
            <Area
              type="monotone"
              dataKey="known_no_purchase"
              stackId="1"
              fill="var(--chart-2)"
              stroke="var(--chart-2)"
            />
            <Area
              type="monotone"
              dataKey="returning_customer"
              stackId="1"
              fill="var(--chart-3)"
              stroke="var(--chart-3)"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function DailyRevenueConversionChart({ rows }: { rows: DailyRow[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="border border-border/70 shadow-none">
        <CardHeader className="pb-2">
          <CardTitle>CA ecommerce</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer className="h-[280px]" config={{ revenue: { label: 'CA', color: 'var(--chart-4)' } }}>
            <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => fmtMoney(Number(value))} />
              <Bar dataKey="revenue" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <Card className="border border-border/70 shadow-none">
        <CardHeader className="pb-2">
          <CardTitle>Conversion</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer
            className="h-[280px]"
            config={{ conversion_rate: { label: 'Conversion', color: 'var(--chart-5)' } }}
          >
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => fmtPct(Number(value))} />
              <Line type="monotone" dataKey="conversion_rate" stroke="var(--chart-5)" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  )
}

function DataQualityPanel({ quality }: { quality: DataQuality }) {
  const rows = [
    {
      label: 'Segments connus sans contact',
      value: quality.sessions_without_contact_but_known_segment,
      ok: quality.sessions_without_contact_but_known_segment === 0,
    },
    {
      label: 'Conversions sans order id',
      value: quality.converted_sessions_without_order_id,
      ok: quality.converted_sessions_without_order_id === 0,
    },
    {
      label: 'Conversions sans order matché',
      value: quality.converted_sessions_without_matching_order,
      ok: quality.converted_sessions_without_matching_order === 0,
    },
    {
      label: 'Devient client sans contact',
      value: quality.became_customer_sessions_without_contact,
      ok: quality.became_customer_sessions_without_contact === 0,
    },
  ]

  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle>Qualité des données</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between rounded-md border p-3">
            <span className="text-sm font-medium">{row.label}</span>
            <Badge variant={row.ok ? 'green' : 'orange'}>{fmtNumber(row.value)}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function MetricCell({ count, rate }: { count: number; rate: number }) {
  return (
    <td className="py-3 pr-3 text-right">
      <div>{fmtNumber(count)}</div>
      <div className="text-xs text-muted-foreground">{fmtPct(rate)}</div>
    </td>
  )
}

function LoadingState() {
  const placeholders = ['sessions', 'revenue', 'known', 'customers', 'views', 'initiated', 'updated', 'aov']
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {placeholders.map((key) => (
        <Skeleton key={key} className="h-28 rounded-md" />
      ))}
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">{message}</div>
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
