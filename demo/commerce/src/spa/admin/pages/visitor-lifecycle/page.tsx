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
  Progress,
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
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  Info,
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
  unique_visitors: number
  sessions: number
  sessions_per_visitor: number
  orders: number
  revenue: number
  aov: number
  converted_visitors: number
  visitor_conversion_rate: number
  converted_sessions: number
  conversion_rate: number
  became_known: number
  became_known_rate: number
  became_customer: number
  became_customer_rate: number
  cart_viewed_visitors: number
  cart_view_rate: number
  cart_initiated_visitors: number
  cart_initiation_rate: number
  cart_updated_visitors: number
  cart_update_rate: number
}

interface AudienceRow {
  key: Segment
  label: string
  visitors: number
  sessions: number
  share: number
  sessions_per_visitor: number
  cart_viewed_visitors: number
  cart_view_rate: number
  cart_initiated_visitors: number
  cart_initiation_rate: number
  cart_updated_visitors: number
  cart_update_rate: number
  converted_visitors: number
  conversion_rate: number
  became_known: number
  became_customer: number
  orders: number
  revenue: number
  aov: number
}

interface DailyRow {
  date: string
  visitors: number
  sessions: number
  unknown: number
  known_no_purchase: number
  returning_customer: number
  became_known: number
  became_customer: number
  converted_visitors: number
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

const CHART_LABELS: Record<string, string> = {
  unknown: 'Suspects',
  known_no_purchase: 'Prospects',
  returning_customer: 'Clients',
  visitors: 'Visiteurs',
  became_known: 'Deviennent prospects',
  became_customer: 'Deviennent clients',
  revenue: 'CA ecommerce',
  conversion_rate: 'Conversion visiteurs',
  visitor_conversion_rate: 'Conversion visiteurs',
}

const DEFAULT_RANGE: DateRangeValue = { kind: 'preset', preset: '30d' }
const tabsGridStyle = { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', width: 'min(100%, 34rem)' }
const summaryGridStyle = { gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }
const metricGridStyle = { gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }
const transitionGridStyle = { gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }
const cartMetricGridStyle = { gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }
const audienceGridStyle = { gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }
const twoColumnGridStyle = { gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }
const flowGridStyle = { gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }
const qualityGridStyle = { gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }
const transitionRowGridStyle = { gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr) 5rem' }

function formatTooltipNumber(value: unknown, name: unknown) {
  const key = String(name)
  return [fmtNumber(Number(value)), CHART_LABELS[key] ?? key]
}

function formatTooltipMoney(value: unknown, name: unknown) {
  const key = String(name)
  return [fmtMoney(Number(value)), CHART_LABELS[key] ?? key]
}

function formatTooltipPercent(value: unknown, name: unknown) {
  const key = String(name)
  return [fmtPct(Number(value)), CHART_LABELS[key] ?? key]
}

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
          <h1 className="text-2xl font-semibold tracking-normal">Lifecycle visiteurs</h1>
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
      <ExecutiveSummary data={data} />
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full" style={tabsGridStyle}>
          <TabsTrigger value="overview">Synthèse</TabsTrigger>
          <TabsTrigger value="audiences">Audiences</TabsTrigger>
          <TabsTrigger value="trends">Évolution</TabsTrigger>
          <TabsTrigger value="quality">Données</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <AudienceCards rows={data.audience} />
          <div className="mt-4 grid gap-4" style={flowGridStyle}>
            <LifecycleFlow rows={data.flow} />
            <ConversionRates audience={data.audience} />
          </div>
          <div className="mt-4 grid gap-4" style={twoColumnGridStyle}>
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

function ExecutiveSummary({ data }: { data: LifecycleDashboardData }) {
  const { kpis } = data
  return (
    <div className="grid gap-4" style={summaryGridStyle}>
      <Card className="border border-border/70 shadow-none">
        <CardContent className="grid gap-4 p-4" style={metricGridStyle}>
          <SummaryMetric
            label="Visiteurs uniques"
            value={fmtNumber(kpis.unique_visitors)}
            detail={`${fmtNumber(kpis.sessions)} sessions · ${formatDecimal(kpis.sessions_per_visitor)} / visiteur`}
            icon={Users}
          />
          <SummaryMetric
            label="CA ecommerce"
            value={fmtMoney(kpis.revenue)}
            detail={`${fmtNumber(kpis.orders)} orders · AOV ${fmtMoney(kpis.aov)}`}
            icon={CircleDollarSign}
          />
          <SummaryMetric
            label="Conversion"
            value={fmtPct(kpis.visitor_conversion_rate)}
            detail={`${fmtNumber(kpis.converted_visitors)} visiteurs convertis`}
            icon={Activity}
          />
        </CardContent>
      </Card>
      <Card className="border border-border/70 shadow-none">
        <CardContent className="grid gap-3 p-4" style={transitionGridStyle}>
          <TransitionMetric
            label="Deviennent prospects"
            value={kpis.became_known}
            rate={kpis.became_known_rate}
            icon={UserCheck}
          />
          <TransitionMetric
            label="Deviennent clients"
            value={kpis.became_customer}
            rate={kpis.became_customer_rate}
            icon={CheckCircle2}
          />
        </CardContent>
      </Card>
      <CartEngagement kpis={kpis} />
    </div>
  )
}

function SummaryMetric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string
  value: string
  detail: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-0.5 truncate text-2xl font-semibold tracking-normal">{value}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  )
}

function TransitionMetric({
  label,
  value,
  rate,
  icon: Icon,
}: {
  label: string
  value: number
  rate: number
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span>{label}</span>
        </div>
        <span className="text-lg font-semibold">{fmtNumber(value)}</span>
      </div>
      <Progress value={rate} className="mt-2 h-1.5" />
      <div className="mt-1 text-xs text-muted-foreground">{fmtPct(rate)} des visiteurs</div>
    </div>
  )
}

function CartEngagement({ kpis }: { kpis: Kpis }) {
  const cards = [
    {
      label: 'Voient un panier',
      value: fmtNumber(kpis.cart_viewed_visitors),
      icon: Eye,
      sub: fmtPct(kpis.cart_view_rate),
    },
    {
      label: 'Initient un panier',
      value: fmtNumber(kpis.cart_initiated_visitors),
      icon: ShoppingCart,
      sub: fmtPct(kpis.cart_initiation_rate),
    },
    {
      label: 'Modifient un panier',
      value: fmtNumber(kpis.cart_updated_visitors),
      icon: MousePointerClick,
      sub: fmtPct(kpis.cart_update_rate),
    },
  ]

  return (
    <Card className="border border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle>Engagement panier</CardTitle>
          <Info className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-3" style={cartMetricGridStyle}>
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className="flex items-center justify-between rounded-md border bg-background p-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-muted-foreground">{card.label}</div>
                <div className="mt-0.5 text-xl font-semibold">{card.value}</div>
              </div>
              <div className="text-right">
                <Icon className="ml-auto h-4 w-4 text-muted-foreground" />
                <div className="mt-1 text-xs text-muted-foreground">{card.sub}</div>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function AudienceCards({ rows }: { rows: AudienceRow[] }) {
  return (
    <div className="grid gap-3" style={audienceGridStyle}>
      {rows.map((row) => (
        <Card key={row.key} className="border border-border/70 shadow-none">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: AUDIENCE_COLORS[row.key] }} />
                  <div className="font-medium">{row.label}</div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{fmtPct(row.share)} des visiteurs</div>
              </div>
              <div className="text-right">
                <div className="text-xl font-semibold">{fmtNumber(row.visitors)}</div>
                <div className="text-xs text-muted-foreground">visiteurs</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
              <AudienceMiniMetric label="Panier" value={fmtPct(row.cart_initiation_rate)} />
              <AudienceMiniMetric label="Convertit" value={fmtPct(row.conversion_rate)} />
              <AudienceMiniMetric label="CA" value={fmtMoney(row.revenue)} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function AudienceMiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/60 p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-medium">{value}</div>
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
          <div key={`${row.from}-${row.to}`} className="grid items-center gap-3" style={transitionRowGridStyle}>
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
              {fmtNumber(row.converted_visitors)} / {fmtNumber(row.visitors)} visiteurs
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
          className="h-[240px]"
          config={{
            visitors: { label: 'Visiteurs', color: 'var(--chart-1)' },
          }}
        >
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <Tooltip formatter={formatTooltipNumber} />
            <Bar dataKey="visitors" radius={[4, 4, 0, 0]}>
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
          className="h-[240px]"
          config={{
            became_known: { label: 'Deviennent prospects', color: 'var(--chart-2)' },
            became_customer: { label: 'Deviennent clients', color: 'var(--chart-3)' },
          }}
        >
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={shortDate} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <Tooltip formatter={formatTooltipNumber} />
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
              <th className="py-2 pr-3 font-medium">Segment</th>
              <th className="py-2 pr-3 text-right font-medium">Visiteurs</th>
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
                <td className="sticky left-0 bg-card py-3 pr-3">
                  <div className="font-medium">{row.label}</div>
                  <div className="text-xs text-muted-foreground">{fmtPct(row.share)} des visiteurs</div>
                </td>
                <td className="py-3 pr-3 text-right">{fmtNumber(row.visitors)}</td>
                <td className="py-3 pr-3 text-right">{fmtNumber(row.sessions)}</td>
                <MetricCell count={row.cart_viewed_visitors} rate={row.cart_view_rate} />
                <MetricCell count={row.cart_initiated_visitors} rate={row.cart_initiation_rate} />
                <MetricCell count={row.cart_updated_visitors} rate={row.cart_update_rate} />
                <MetricCell count={row.converted_visitors} rate={row.conversion_rate} />
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
        <CardTitle>Visiteurs par audience</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          className="h-[300px]"
          config={{
            unknown: { label: 'Suspects', color: 'var(--chart-1)' },
            known_no_purchase: { label: 'Prospects', color: 'var(--chart-2)' },
            returning_customer: { label: 'Clients', color: 'var(--chart-3)' },
          }}
        >
          <AreaChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={shortDate} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <Tooltip formatter={formatTooltipNumber} />
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
    <div className="grid gap-4" style={twoColumnGridStyle}>
      <Card className="border border-border/70 shadow-none">
        <CardHeader className="pb-2">
          <CardTitle>CA ecommerce</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer className="h-[240px]" config={{ revenue: { label: 'CA', color: 'var(--chart-4)' } }}>
            <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                tickFormatter={shortDate}
              />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <Tooltip formatter={formatTooltipMoney} />
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
            className="h-[240px]"
            config={{ conversion_rate: { label: 'Conversion', color: 'var(--chart-5)' } }}
          >
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                tickFormatter={shortDate}
              />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <Tooltip formatter={formatTooltipPercent} />
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
      label: 'Segments prospects ou clients sans contact',
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
      <CardContent className="grid gap-3" style={qualityGridStyle}>
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
  const placeholders = ['visitors', 'revenue', 'known', 'customers', 'views', 'initiated', 'updated', 'aov']
  return (
    <div className="grid gap-3" style={audienceGridStyle}>
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

function formatDecimal(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)
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
