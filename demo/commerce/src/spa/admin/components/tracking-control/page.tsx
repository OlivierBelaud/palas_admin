import { useDashboardContext } from '@mantajs/dashboard'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@mantajs/ui'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { earliestParisDate, parisDate } from '../../../../modules/tracking-control/calendar'
import type { ControlDestination, TrackingControlData } from '../../../../modules/tracking-control/types'
import { MetaComparison } from './comparison'
import { formatTime, RemoteEvidence } from './evidence'
import { LocalEvidence, RecentReceipts } from './local-evidence'

const destinations: Array<{ key: ControlDestination; name: string; path: string }> = [
  { key: 'meta_capi', name: 'Meta', path: 'meta' },
  { key: 'google_ads', name: 'Google Ads', path: 'google-ads' },
  { key: 'pinterest', name: 'Pinterest', path: 'pinterest' },
  { key: 'ga4', name: 'GA4', path: 'ga4' },
]
const hourOptions = [1, 4, 7, 12, 24]
const inputClass = 'h-9 max-w-full rounded-md border border-input bg-background px-3 text-sm'
const buttonClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-50'
type CustomWindow = { from: string; to: string }

function inputTime(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 16)
}

function validateCustom(
  from: string,
  to: string,
): { window: CustomWindow; error?: never } | { error: string; window?: never } {
  const start = new Date(`${from}Z`).getTime()
  const end = new Date(`${to}Z`).getTime()
  const now = Date.now()
  if (!from || !to || !Number.isFinite(start) || !Number.isFinite(end)) {
    return { error: 'Renseignez une date et une heure de début et de fin, en UTC.' }
  }
  if (start >= end) return { error: 'La fin doit être après le début.' }
  if (end > now) return { error: 'La période ne peut pas se terminer dans le futur.' }
  if (start < now - 24 * 60 * 60 * 1000) {
    return { error: 'Choisissez une période entièrement comprise dans les dernières 24 heures.' }
  }
  return { window: { from: new Date(start).toISOString(), to: new Date(end).toISOString() } }
}

export function TrackingControlPage({ destination }: { destination: ControlDestination }) {
  const { dataSource } = useDashboardContext()
  const name = destinations.find((item) => item.key === destination)?.name || destination
  const [period, setPeriod] = React.useState('4')
  const [day, setDay] = React.useState(parisDate())
  const [customFrom, setCustomFrom] = React.useState(() => inputTime(Date.now() - 4 * 60 * 60 * 1000))
  const [customTo, setCustomTo] = React.useState(() => inputTime(Date.now()))
  const [customWindow, setCustomWindow] = React.useState<CustomWindow | null>(null)
  const [validationError, setValidationError] = React.useState<string | null>(null)
  const [data, setData] = React.useState<TrackingControlData | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refresh, setRefresh] = React.useState(0)
  const sequence = React.useRef(0)

  const invalidate = () => {
    sequence.current += 1
    setData(null)
    setError(null)
    setValidationError(null)
  }

  React.useEffect(() => {
    const request = ++sequence.current
    let cancelled = false
    setData(null)
    setError(null)
    if (period === 'custom' && !customWindow) {
      setLoading(false)
      return () => {
        cancelled = true
      }
    }
    const search = new URLSearchParams({ destination })
    if (period === 'custom' && customWindow) {
      search.set('from', customWindow.from)
      search.set('to', customWindow.to)
    } else if (period === 'day') {
      search.set('date', day)
    } else {
      search.set('hours', period)
    }
    setLoading(true)
    void dataSource
      .fetch(`/api/admin/tracking-control?${search.toString()}`)
      .then((response: unknown) => {
        if (cancelled || request !== sequence.current) return
        const next = (response as { data?: TrackingControlData } | null)?.data
        if (!next || next.destination !== destination) {
          setError('La réponse de contrôle est indisponible. Réessayez dans un instant.')
          return
        }
        setData(next)
      })
      .catch(() => {
        if (cancelled || request !== sequence.current) return
        setError(
          'Le contrôle n’a pas pu être chargé. Vérifiez votre connexion et votre accès administrateur, puis réessayez.',
        )
      })
      .finally(() => {
        if (!cancelled && request === sequence.current) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dataSource, destination, period, day, customWindow, refresh])

  const applyCustom = () => {
    invalidate()
    const result = validateCustom(customFrom, customTo)
    if (result.error) {
      setCustomWindow(null)
      setLoading(false)
      setValidationError(result.error)
      return
    }
    setCustomWindow(result.window || null)
    setRefresh((value) => value + 1)
  }

  const currentData = data?.destination === destination ? data : null
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Contrôle tracking · {name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Comparez les traces du CRM aux preuves disponibles chez {name}, sur la période choisie. Les détails des
          accusés sont conservés 24 heures.
        </p>
      </div>
      <nav aria-label="Destinations tracking" className="flex flex-wrap gap-2 rounded-lg border bg-muted/25 p-1.5">
        <Link
          to="/tracking-health"
          className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Vue Tracking
        </Link>
        {destinations.map((item) => (
          <Link
            key={item.key}
            to={`/tracking-health/${item.path}`}
            aria-current={destination === item.key ? 'page' : undefined}
            className={`rounded-md px-3 py-2 text-sm ${destination === item.key ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {item.name}
          </Link>
        ))}
      </nav>
      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span>Période de contrôle</span>
              <select
                className={inputClass}
                value={period}
                onChange={(event) => {
                  invalidate()
                  setPeriod(event.target.value)
                  setCustomWindow(null)
                  setLoading(event.target.value !== 'custom')
                }}
              >
                {hourOptions.map((hours) => (
                  <option key={hours} value={hours}>
                    Dernières {hours} h
                  </option>
                ))}
                <option value="day">Une journée (Paris)</option>
                <option value="custom">Période personnalisée</option>
              </select>
            </label>
            {period === 'day' ? (
              <label className="flex flex-col gap-1 text-sm">
                <span>Journée (heure de Paris)</span>
                <input
                  className={inputClass}
                  type="date"
                  value={day}
                  max={parisDate()}
                  min={earliestParisDate()}
                  onChange={(event) => {
                    invalidate()
                    setDay(event.target.value)
                  }}
                />
              </label>
            ) : null}
            <button
              type="button"
              className={buttonClass}
              disabled={loading || (period === 'custom' && !customWindow)}
              onClick={() => {
                if (period === 'custom') applyCustom()
                else {
                  invalidate()
                  setRefresh((value) => value + 1)
                }
              }}
            >
              Actualiser
            </button>
            <span className="pb-2 text-xs text-muted-foreground">
              {period === 'day' ? 'Journée en heure de Paris' : 'Heures en UTC'} · actualisation manuelle
            </span>
          </div>
          {period === 'custom' ? (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                applyCustom()
              }}
            >
              <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">
                <span>Début (UTC)</span>
                <input
                  type="datetime-local"
                  className={inputClass}
                  value={customFrom}
                  max={inputTime(Date.now())}
                  aria-describedby="custom-period-help"
                  onChange={(event) => {
                    invalidate()
                    setCustomFrom(event.target.value)
                    setCustomWindow(null)
                    setLoading(false)
                  }}
                  required
                />
              </label>
              <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">
                <span>Fin (UTC)</span>
                <input
                  type="datetime-local"
                  className={inputClass}
                  value={customTo}
                  max={inputTime(Date.now())}
                  aria-describedby="custom-period-help"
                  onChange={(event) => {
                    invalidate()
                    setCustomTo(event.target.value)
                    setCustomWindow(null)
                    setLoading(false)
                  }}
                  required
                />
              </label>
              <button type="submit" className={buttonClass} disabled={loading}>
                Appliquer la période
              </button>
              <p id="custom-period-help" className="w-full text-xs text-muted-foreground">
                Le début est inclus, la fin est exclue. Toute la période doit être dans les dernières 24 heures.
              </p>
            </form>
          ) : null}
          {validationError ? (
            <p role="alert" className="text-sm text-red-700">
              {validationError}
            </p>
          ) : null}
          {currentData ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                Période demandée : {formatTime(currentData.requested_window.from)} →{' '}
                {formatTime(currentData.requested_window.to)}
              </p>
              <p>
                Contrôle généré le {formatTime(currentData.generated_at)}. Chaque rapport distant indique sa propre date
                de lecture.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
      {loading ? (
        <p role="status" className="rounded-lg border p-5 text-sm text-muted-foreground">
          Lecture des traces CRM et des données {name}…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {!loading && !error && !currentData && period === 'custom' ? (
        <p className="text-sm text-muted-foreground">
          Choisissez votre intervalle, puis appliquez la période pour lancer le contrôle.
        </p>
      ) : null}
      {currentData ? (
        <>
          <Connection data={currentData} />
          <MetaComparison data={currentData} />
          <LocalEvidence local={currentData.local} destination={destination} />
          <div className="space-y-1 pt-2">
            <h2 className="text-lg font-semibold">Ce que rapporte {name}</h2>
            <p className="text-sm text-muted-foreground">
              Les périodes et les expéditeurs peuvent différer du CRM. Des totaux égaux ne prouvent pas la livraison de
              chaque événement ; un écart ne prouve pas une perte. La réception ne prouve pas l’attribution
              publicitaire.
            </p>
          </div>
          {currentData.remote.length ? (
            currentData.remote.map((section) => <RemoteEvidence key={section.key} section={section} />)
          ) : (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">
              Aucune preuve distante disponible pour ce contrôle.
            </p>
          )}
          <RecentReceipts local={currentData.local} destination={destination} />
        </>
      ) : null}
    </div>
  )
}

function Connection({ data }: { data: TrackingControlData }) {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Destination configurée sur ce serveur</CardTitle>
          <Badge variant="outline">{data.config.send_configured ? 'Envoi configuré' : 'Envoi non configuré'}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Configuration actuelle. Elle ne décrit pas forcément le mode utilisé pour les événements précédents et ne
          garantit pas l’accès aux rapports.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          {data.config.identifiers.map((identifier) => (
            <div key={identifier.label} className="min-w-0">
              <dt className="text-muted-foreground">{identifier.label}</dt>
              <dd className="break-all font-mono select-all">{identifier.value || 'Non renseigné'}</dd>
            </div>
          ))}
          <div>
            <dt className="text-muted-foreground">Mode actuel</dt>
            <dd>{data.config.current_mode}</dd>
          </div>
        </dl>
        {data.config.setup.length ? (
          <details>
            <summary className="cursor-pointer font-medium">Accès et configuration nécessaires</summary>
            <ul className="mt-2 list-disc space-y-1 break-words pl-5 text-muted-foreground">
              {data.config.setup.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  )
}
