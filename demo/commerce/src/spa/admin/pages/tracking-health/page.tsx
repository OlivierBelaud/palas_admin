import { useQuery } from '@manta/sdk'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@manta/ui'
import * as React from 'react'

interface TrackingHealthData {
  meta: {
    range: { from: string; to: string }
    generated_at: string
    retention_hours: number
  }
  kpis: {
    total: number
    valid: number
    invalid: number
    identified: number
    anonymous: number
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
    source: string
    received_at: string
    page_type: string | null
    market: string | null
    identity: 'email' | 'muid' | 'posthog' | 'anon'
    valid: boolean
    validation_errors: string[]
    value: number | null
    currency: string | null
    item_count: number | null
    cart_token: string | null
    checkout_token: string | null
    shopify_order_id: string | null
  }>
}

const HOURS_OPTIONS = [1, 4, 12, 24]
const kpiGridStyle = { gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }

export default function TrackingHealthPage() {
  const [hours, setHours] = React.useState(4)
  const [eventName, setEventName] = React.useState('all')
  const params = React.useMemo(() => ({ hours, limit: 300, event_name: eventName }), [hours, eventName])
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
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={hours}
            onChange={(event: { target: { value: string } }) => setHours(Number(event.target.value))}
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
            onChange={(event: { target: { value: string } }) => setEventName(event.target.value)}
          >
            <option value="all">Tous les events</option>
            {eventOptions.map((name: string) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <Button variant="outline" size="small" onClick={() => query.refetch()} isLoading={query.isFetching}>
            Refresh
          </Button>
        </div>
      </div>

      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={query.error.message} /> : null}
      {data ? (
        <>
          <Kpis data={data} />
          <EventTypeTable rows={data.event_types} active={eventName} setActive={setEventName} />
          <LiveEventTable events={data.events} />
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

function LiveEventTable({ events }: { events: TrackingHealthData['events'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Log live</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2 pr-4 font-medium">Reçu</th>
              <th className="py-2 pr-4 font-medium">Event</th>
              <th className="py-2 pr-4 font-medium">Source</th>
              <th className="py-2 pr-4 font-medium">Page</th>
              <th className="py-2 pr-4 font-medium">Identité</th>
              <th className="py-2 pr-4 font-medium">Valeur</th>
              <th className="py-2 pr-4 font-medium">Articles</th>
              <th className="py-2 pr-4 font-medium">Statut</th>
              <th className="py-2 pr-4 font-medium">Event ID</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b align-top last:border-0">
                <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{formatTime(event.received_at)}</td>
                <td className="py-2 pr-4 font-medium">{event.event_name}</td>
                <td className="py-2 pr-4">{event.source}</td>
                <td className="py-2 pr-4">{event.page_type ?? '-'}</td>
                <td className="py-2 pr-4">
                  <Badge variant={event.identity === 'anon' ? 'outline' : 'secondary'}>{event.identity}</Badge>
                </td>
                <td className="py-2 pr-4">
                  {event.value == null ? '-' : `${fmtNumber(event.value)} ${event.currency ?? ''}`}
                </td>
                <td className="py-2 pr-4">{event.item_count ?? '-'}</td>
                <td className="py-2 pr-4">
                  {event.valid ? (
                    <Badge variant="secondary">ok</Badge>
                  ) : (
                    <Badge variant="destructive">{event.validation_errors.join(', ') || 'invalid'}</Badge>
                  )}
                </td>
                <td className="max-w-[220px] truncate py-2 pr-4 font-mono text-xs text-muted-foreground">
                  {event.event_id}
                </td>
              </tr>
            ))}
            {events.length === 0 ? (
              <tr>
                <td className="py-6 text-center text-muted-foreground" colSpan={9}>
                  Aucun event reçu.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
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
