import { useQuery } from '@mantajs/sdk'
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton, Table } from '@mantajs/ui'
import * as React from 'react'

interface TrackingHealthData {
  meta: {
    range: { from: string; to: string }
    generated_at: string
    latest_event_at: string | null
    retention_hours: number
    pagination: {
      limit: number
      offset: number
      total: number
      page: number
      page_count: number
    }
  }
  kpis: {
    total: number
    valid: number
    invalid: number
    identified: number
    anonymous: number
    ga4_ready: number
    ga4_pending: number
    ga4_sent: number
    ga4_invalid: number
    ga4_error: number
    posthog_forwarded: number
  }
  event_types: Array<{
    event_name: string
    count: number
    valid: number
    invalid: number
    latest_at: string | null
  }>
  events: Array<{
    id: string
    event_id: string
    event_name: string
    raw_event_name: string
    source: string
    received_at: string
    page_type: string | null
    market: string | null
    identity: 'contact' | 'email' | 'muid' | 'posthog' | 'anon'
    identity_source: string | null
    contact_id: string | null
    email: string | null
    email_status: 'resolved' | 'hashed' | 'unknown'
    matched_v1: boolean
    valid: boolean
    validation_errors: string[]
    value: number | null
    currency: string | null
    item_count: number | null
    cart_token: string | null
    checkout_token: string | null
    shopify_order_id: string | null
    posthog_status: string
    posthog_http_status: number | null
    ga4_ready: boolean
    ga4_status: string
    ga4_http_status: number | null
    ga4_error_code: string | null
    ga4_error_message: string | null
    ga4_attempt_count: number
    ga4_sent_at: string | null
  }>
}

const HOURS_OPTIONS = [1, 4, 12, 24]
const PAGE_SIZE = 50
const LIVE_STALE_MS = 2 * 60 * 1000
const kpiGridStyle = { gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }

export default function TrackingHealthPage() {
  const [hours, setHours] = React.useState(4)
  const [eventName, setEventName] = React.useState('all')
  const [pageIndex, setPageIndex] = React.useState(0)
  const params = React.useMemo(
    () => ({ hours, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE, event_name: eventName }),
    [hours, eventName, pageIndex],
  )
  const query = useQuery<TrackingHealthData>('tracking-health', params, {
    staleTime: 0,
    refetchInterval: 1000,
  })
  const data = query.data

  const eventOptions = React.useMemo(() => {
    const names = new Set(data?.event_types.map((row) => row.event_name) ?? [])
    if (eventName !== 'all') names.add(eventName)
    return Array.from(names).sort()
  }, [data?.event_types, eventName])

  const selectHours = (value: number) => {
    setHours(value)
    setPageIndex(0)
  }

  const selectEventName = (value: string) => {
    setEventName(value)
    setPageIndex(0)
  }

  const live = getLiveState(data, query.isError)

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-normal">Tracking health</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {data ? <Badge variant="outline">Dernières {hours}h</Badge> : null}
            {data ? <span>Mis à jour {formatDateTime(data.meta.generated_at)}</span> : null}
            {data ? <span>Rétention {data.meta.retention_hours}h</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm">
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 rounded-full ${live.ok ? 'animate-pulse bg-emerald-500' : 'bg-red-500'}`}
            />
            <span className={live.ok ? 'text-emerald-700' : 'text-red-700'}>{live.label}</span>
          </div>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={hours}
            onChange={(event: { target: { value: string } }) => selectHours(Number(event.target.value))}
          >
            {HOURS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}h
              </option>
            ))}
          </select>
          <select
            className="h-9 min-w-44 rounded-md border border-input bg-background px-3 text-sm"
            value={eventName}
            onChange={(event: { target: { value: string } }) => selectEventName(event.target.value)}
          >
            <option value="all">Tous les events</option>
            {eventOptions.map((name: string) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={query.error.message} /> : null}
      {data ? (
        <>
          <Kpis data={data} />
          <EventTypeTable rows={data.event_types} active={eventName} setActive={selectEventName} />
          <LiveEventTable data={data} pageIndex={pageIndex} setPageIndex={setPageIndex} />
        </>
      ) : null}
    </div>
  )
}

function Kpis({ data }: { data: TrackingHealthData }) {
  const cards = [
    { label: 'Events reçus', value: data.kpis.total, detail: 'hot log', mark: 'EV' },
    { label: 'Valides', value: data.kpis.valid, detail: `${data.kpis.invalid} invalides`, mark: 'OK' },
    { label: 'Identifiés', value: data.kpis.identified, detail: `${data.kpis.anonymous} anonymes`, mark: 'ID' },
    {
      label: 'GA4',
      value: data.kpis.ga4_sent,
      detail: `${data.kpis.ga4_pending} attente · ${data.kpis.ga4_invalid + data.kpis.ga4_error} à corriger`,
      mark: 'G4',
    },
    { label: 'PostHog', value: data.kpis.posthog_forwarded, detail: 'forward observé', mark: 'PH' },
  ]
  return (
    <div className="grid gap-4" style={kpiGridStyle}>
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
            <span className="font-mono text-xs text-muted-foreground">{card.mark}</span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{fmtNumber(card.value)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{card.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function EventTypeTable({
  rows,
  active,
  setActive,
}: {
  rows: TrackingHealthData['event_types']
  active: string
  setActive: (value: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Types d'events</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2 pr-4 font-medium">Event</th>
              <th className="py-2 pr-4 font-medium">Total</th>
              <th className="py-2 pr-4 font-medium">Valides</th>
              <th className="py-2 pr-4 font-medium">Invalides</th>
              <th className="py-2 pr-4 font-medium">Dernier reçu</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.event_name} className="border-b last:border-0">
                <td className="py-2 pr-4">
                  <button
                    className={active === row.event_name ? 'font-semibold text-foreground' : 'text-primary'}
                    onClick={() => setActive(row.event_name)}
                    type="button"
                  >
                    {row.event_name}
                  </button>
                </td>
                <td className="py-2 pr-4">{fmtNumber(row.count)}</td>
                <td className="py-2 pr-4">{fmtNumber(row.valid)}</td>
                <td className="py-2 pr-4">{fmtNumber(row.invalid)}</td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {row.latest_at ? formatDateTime(row.latest_at) : '-'}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="py-6 text-center text-muted-foreground" colSpan={5}>
                  Aucun event reçu sur cette fenêtre.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function LiveEventTable({
  data,
  pageIndex,
  setPageIndex,
}: {
  data: TrackingHealthData
  pageIndex: number
  setPageIndex: (value: number) => void
}) {
  const events = data.events
  const pageCount = data.meta.pagination.page_count
  const total = data.meta.pagination.total
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Log live</CardTitle>
        <span className="text-sm text-muted-foreground">50 lignes par page</span>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table className="min-w-[1380px]">
          <Table.Header>
            <Table.Row>
              <Table.Head>Reçu</Table.Head>
              <Table.Head>Canonique</Table.Head>
              <Table.Head>Raw</Table.Head>
              <Table.Head>Page</Table.Head>
              <Table.Head>Identité</Table.Head>
              <Table.Head>Email</Table.Head>
              <Table.Head>Valeur</Table.Head>
              <Table.Head>Articles</Table.Head>
              <Table.Head>PostHog</Table.Head>
              <Table.Head>GA4</Table.Head>
              <Table.Head>Validité</Table.Head>
              <Table.Head>Event ID</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {events.map((event) => (
              <Table.Row key={event.id} className="align-top">
                <Table.Cell className="whitespace-nowrap text-muted-foreground">
                  {formatTime(event.received_at)}
                </Table.Cell>
                <Table.Cell className="font-medium">{event.event_name}</Table.Cell>
                <Table.Cell className="text-muted-foreground">{event.raw_event_name}</Table.Cell>
                <Table.Cell>{event.page_type ?? '-'}</Table.Cell>
                <Table.Cell>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <Badge variant={event.identity === 'anon' ? 'outline' : 'secondary'}>{event.identity}</Badge>
                      {event.matched_v1 ? <Badge variant="outline">v1=v2</Badge> : null}
                    </div>
                    <span className="max-w-[160px] truncate text-xs text-muted-foreground">
                      {event.identity_source ?? 'no identity'}
                    </span>
                  </div>
                </Table.Cell>
                <Table.Cell className="max-w-[220px]">
                  {event.email ? (
                    <span className="block truncate" title={event.email}>
                      {event.email}
                    </span>
                  ) : event.email_status === 'hashed' ? (
                    <Badge variant="outline">hashé</Badge>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {event.value == null ? '-' : `${fmtNumber(event.value)} ${event.currency ?? ''}`}
                </Table.Cell>
                <Table.Cell>{event.item_count ?? '-'}</Table.Cell>
                <Table.Cell>
                  <Badge variant={event.posthog_status === 'forwarded' ? 'secondary' : 'outline'}>
                    {event.posthog_http_status
                      ? `${event.posthog_status} ${event.posthog_http_status}`
                      : event.posthog_status}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <div className="flex flex-col gap-1">
                    <Badge variant={ga4BadgeVariant(event.ga4_status)}>{formatGa4Status(event)}</Badge>
                    {event.ga4_error_code ? (
                      <span
                        className="max-w-[180px] truncate text-xs text-muted-foreground"
                        title={event.ga4_error_message ?? event.ga4_error_code}
                      >
                        {event.ga4_error_code}
                      </span>
                    ) : null}
                  </div>
                </Table.Cell>
                <Table.Cell>
                  {event.valid ? (
                    <Badge variant="secondary">ok</Badge>
                  ) : (
                    <Badge variant="destructive">{event.validation_errors.join(', ') || 'invalid'}</Badge>
                  )}
                </Table.Cell>
                <Table.Cell className="max-w-[220px] truncate font-mono text-xs text-muted-foreground">
                  {event.event_id}
                </Table.Cell>
              </Table.Row>
            ))}
            {events.length === 0 ? (
              <Table.Row>
                <Table.Cell className="py-6 text-center text-muted-foreground" colSpan={12}>
                  Aucun event reçu.
                </Table.Cell>
              </Table.Row>
            ) : null}
          </Table.Body>
        </Table>
      </CardContent>
      <Table.Pagination
        canNextPage={pageIndex + 1 < pageCount}
        canPreviousPage={pageIndex > 0}
        nextPage={() => setPageIndex(pageIndex + 1)}
        previousPage={() => setPageIndex(Math.max(0, pageIndex - 1))}
        count={total}
        pageIndex={pageIndex}
        pageCount={pageCount}
        pageSize={PAGE_SIZE}
        translations={{ of: 'sur', results: 'events', pages: 'pages', prev: 'Préc.', next: 'Suiv.' }}
      />
    </Card>
  )
}

function getLiveState(data: TrackingHealthData | undefined, isError: boolean) {
  if (isError) return { ok: false, label: 'Erreur' }
  if (!data?.meta.latest_event_at) return { ok: false, label: 'Aucun event' }
  const age = Date.now() - new Date(data.meta.latest_event_at).getTime()
  if (age > LIVE_STALE_MS) return { ok: false, label: 'Silencieux' }
  return { ok: true, label: 'Live' }
}

function LoadingState() {
  return (
    <div className="grid gap-4" style={kpiGridStyle}>
      <Skeleton className="h-28" />
      <Skeleton className="h-28" />
      <Skeleton className="h-28" />
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-destructive">
      <CardContent className="py-6 text-sm text-destructive">{message}</CardContent>
    </Card>
  )
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function fmtNumber(value: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)
}

function ga4BadgeVariant(status: string) {
  if (status === 'sent') return 'secondary'
  if (status === 'invalid' || status === 'error') return 'destructive'
  return 'outline'
}

function formatGa4Status(event: TrackingHealthData['events'][number]) {
  if (event.ga4_http_status) return `${event.ga4_status} ${event.ga4_http_status}`
  if (event.ga4_attempt_count > 0) return `${event.ga4_status} x${event.ga4_attempt_count}`
  return event.ga4_status
}
