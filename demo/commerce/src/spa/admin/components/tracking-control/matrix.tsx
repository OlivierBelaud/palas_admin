import { useDashboardContext } from '@mantajs/dashboard'
import { Card, CardContent, CardHeader, CardTitle } from '@mantajs/ui'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { earliestParisDate, parisDate } from '../../../../modules/tracking-control/calendar'
import type { MatrixCell, TrackingMatrix } from '../../../../modules/tracking-control/matrix'
import type { ControlDestination, EvidenceSection } from '../../../../modules/tracking-control/types'

const platforms: Array<{ key: ControlDestination; name: string; path: string }> = [
  { key: 'ga4', name: 'GA4', path: 'ga4' },
  { key: 'meta_capi', name: 'Meta', path: 'meta' },
  { key: 'google_ads', name: 'Google Ads', path: 'google-ads' },
  { key: 'pinterest', name: 'Pinterest', path: 'pinterest' },
]
const style = 'h-9 rounded-md border border-input bg-background px-3 text-sm'
const n = (value: number) => value.toLocaleString('fr-FR')
const time = (value: string) =>
  new Date(value).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

export function TrackingMatrixCard({
  hours,
  active,
  onSelect,
}: {
  hours: number
  active: string
  onSelect: (event: string) => void
}) {
  const { dataSource } = useDashboardContext()
  const [period, setPeriod] = React.useState(String(hours))
  const [day, setDay] = React.useState(parisDate())
  const [refresh, setRefresh] = React.useState(0)
  const [data, setData] = React.useState<TrackingMatrix | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [checking, setChecking] = React.useState(false)
  React.useEffect(() => setPeriod(String(hours)), [hours])
  React.useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    setChecking(true)
    const query = new URLSearchParams({ view: 'matrix', destination: 'meta_capi', remote: '0' })
    if (period === 'day') query.set('date', day)
    else query.set('hours', period)
    const read = async (params: URLSearchParams) => {
      const response = (await dataSource.fetch(`/api/admin/tracking-control?${params}`)) as { data?: TrackingMatrix }
      if (!response.data?.rows || !response.data.window) throw new Error('Réponse de contrôle indisponible.')
      return response.data
    }
    void (async () => {
      try {
        const local = await read(query)
        if (cancelled) return
        setData(local)
        const remote = new URLSearchParams({
          view: 'matrix',
          destination: 'meta_capi',
          from: local.window.from,
          to: local.window.to,
          remote: '1',
        })
        const checked = await read(remote)
        if (!cancelled) setData(checked)
      } catch {
        if (!cancelled)
          setError(
            'La lecture du contrôle a échoué. Les résultats déjà affichés restent des accusés conservés ; réessayez avec Actualiser.',
          )
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dataSource, period, day, refresh])
  const earliest = earliestParisDate()
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Contrôle des événements par plateforme</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Événements reçus par le CRM dans la période, envois et confirmations des plateformes.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="matrix-period">
              Période du contrôle
            </label>
            <select id="matrix-period" className={style} value={period} onChange={(e) => setPeriod(e.target.value)}>
              {[1, 4, 7, 12, 24].map((h) => (
                <option key={h} value={h}>
                  Dernières {h} h
                </option>
              ))}
              <option value="day">Une journée</option>
            </select>
            {period === 'day' ? (
              <>
                <label className="sr-only" htmlFor="matrix-day">
                  Journée en heure de Paris
                </label>
                <input
                  id="matrix-day"
                  type="date"
                  className={style}
                  value={day}
                  min={earliest}
                  max={parisDate()}
                  onChange={(e) => setDay(e.target.value)}
                />
              </>
            ) : null}
            <button
              type="button"
              className={`${style} hover:bg-muted disabled:opacity-50`}
              disabled={checking || !day}
              onClick={() => setRefresh((v) => v + 1)}
            >
              Actualiser
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {data
            ? `${time(data.window.from)} → ${time(data.window.to)} · heure de Paris · état actuel des envois`
            : 'Chargement de la période…'}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <p role="alert" className="text-sm text-amber-800">
            {error}
          </p>
        ) : null}
        {checking ? (
          <p role="status" className="text-xs text-muted-foreground">
            {data ? 'Vérification auprès des API en cours…' : 'Lecture des événements…'}
          </p>
        ) : null}
        {data ? (
          <>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <caption className="sr-only">
                  Événements CRM et confirmations API. Une cellule vide indique un événement non pris en charge.
                </caption>
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th rowSpan={2} className="p-3">
                      Événement
                    </th>
                    <th rowSpan={2} className="p-3 text-right">
                      Total CRM
                    </th>
                    {platforms.map((p) => (
                      <th key={p.key} colSpan={2} className="border-l p-3 text-center">
                        <Link className="underline underline-offset-4" to={`/tracking-health/${p.path}`}>
                          {p.name}
                        </Link>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {platforms.map((p) => (
                      <React.Fragment key={p.key}>
                        <th className="border-l px-3 pb-3 text-right font-normal">Envoyés</th>
                        <th className="px-3 pb-3 text-right font-normal">Reçus</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.event_name} className={`border-t ${active === row.event_name ? 'bg-muted/50' : ''}`}>
                      <td className="p-3 font-medium">
                        <button
                          type="button"
                          className="text-left hover:underline"
                          onClick={() => onSelect(active === row.event_name ? 'all' : row.event_name)}
                        >
                          {row.event_name}
                        </button>
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {n(row.captured)}
                        <small className="block text-muted-foreground">{n(row.valid)} valides</small>
                      </td>
                      {platforms.map((p) => {
                        const cell = row.platforms[p.key]
                        return cell ? (
                          <React.Fragment key={p.key}>
                            <td className="border-l p-3 text-right align-top tabular-nums">
                              {cell.unknown_mode > 0
                                ? cell.sent > 0
                                  ? `≥ ${n(cell.sent)}`
                                  : 'Non confirmé'
                                : n(cell.sent)}
                              {cell.unknown_mode > 0 ? (
                                <small className="block text-amber-800">{n(cell.unknown_mode)} : mode inconnu</small>
                              ) : null}
                              {cell.tests > 0 ? (
                                <small className="block text-muted-foreground">{n(cell.tests)} tests exclus</small>
                              ) : null}
                            </td>
                            <td className="p-3 text-right align-top">
                              <Receipt cell={cell} destination={p.key} />
                              <RemoteCount data={data} cell={cell} event={row.event_name} destination={p.key} />
                            </td>
                          </React.Fragment>
                        ) : (
                          <td
                            key={p.key}
                            colSpan={2}
                            className="border-l"
                            aria-label={`${p.name} : événement non pris en charge`}
                          />
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              « Accusés API » : confirmations retournées à nos envois, conservées 24 h. « Relu » : lecture distante
              effectuée maintenant. Réception et traitement ne prouvent pas l’attribution publicitaire. Cellule vide :
              événement non pris en charge. « Mode inconnu » : détails supprimés, collecte et test indiscernables.
            </p>
            <details className="rounded-md border p-3 text-sm">
              <summary className="cursor-pointer font-medium">Sources, périodes et accès API</summary>
              <div className="mt-3 space-y-4">
                {platforms.map((p) => (
                  <div key={p.key}>
                    <strong>{p.name}</strong>
                    {p.key === 'pinterest' ? (
                      <p>
                        Réponses Pinterest : événements reçus et traités. L’API de qualité ne fournit pas un registre de
                        réception à relire.
                      </p>
                    ) : (
                      data.providers[p.key]?.sections
                        .filter((s) =>
                          ['meta_server', 'google_processing', 'ga4_report', 'provider_read'].includes(s.key),
                        )
                        .map((s) => (
                          <div key={s.key} className="mt-1 space-y-1 text-muted-foreground">
                            <p>{s.message}</p>
                            <p>
                              {s.source} · {s.fetched_at ? `relu le ${time(s.fetched_at)}` : 'lecture non effectuée'}
                            </p>
                            <p>
                              {s.window
                                ? `Période distante : ${s.window.from} → ${s.window.to} (${s.window.timezone})`
                                : 'Bornes distantes non retournées : comparaison horaire non vérifiable.'}
                            </p>
                            <p>{s.provenance}</p>
                            {s.limitations.map((l) => (
                              <p key={l}>{l}</p>
                            ))}
                          </div>
                        ))
                    )}
                  </div>
                ))}
              </div>
            </details>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Receipt({ cell, destination }: { cell: MatrixCell; destination: ControlDestination }) {
  if (destination === 'ga4') return <span className="text-xs text-muted-foreground">Pas d’accusé GA4</span>
  const known = cell.received || 0
  return (
    <>
      <span className="tabular-nums">
        {cell.unconfirmed > 0 ? (known > 0 ? `≥ ${n(known)}` : 'Non confirmé') : n(known)}
      </span>
      <span className="block text-[11px] text-muted-foreground">
        {destination === 'pinterest' ? 'Reçus et traités · accusés API' : 'Accusés API'}
      </span>
      {cell.unconfirmed > 0 ? (
        <span className="block text-[11px] text-amber-800">{n(cell.unconfirmed)} sans preuve conservée</span>
      ) : null}
    </>
  )
}

function RemoteCount({
  data,
  cell,
  event,
  destination,
}: {
  data: TrackingMatrix
  cell: MatrixCell
  event: string
  destination: ControlDestination
}) {
  if (destination === 'pinterest') return null
  const section = data.providers[destination]?.sections.find(
    (s) =>
      s.key === 'provider_read' ||
      s.key ===
        ({ meta_capi: 'meta_server', google_ads: 'google_processing', ga4: 'ga4_report' } as const)[destination],
  )
  if (!section) return <span className="block text-[11px] text-muted-foreground">Lecture distante en attente</span>
  if (!['available', 'partial'].includes(section.state))
    return (
      <span className="mt-1 block text-[11px] text-amber-800" title={section.message}>
        {readState(section)}
      </span>
    )
  if (destination === 'google_ads') {
    const statuses = ['SUCCESS', 'PROCESSING', 'FAILED', 'PARTIAL_SUCCESS']
    const labels = ['traitées', 'en cours', 'rejetées', 'partiellement traitées']
    const rows = section.rows.filter((r) => r.event_name === event && statuses.includes(r.label))
    return (
      <span className="mt-1 block text-[11px] text-muted-foreground">
        {rows.length
          ? rows.map((r) => `${r.value} ${labels[statuses.indexOf(r.label)]}`).join(' · ')
          : cell.sent
            ? 'Aucune requête relue'
            : 'Aucun envoi à relire'}
        {section.state === 'partial' ? ' · lecture partielle' : ''}
      </span>
    )
  }
  const remote = section.rows.filter((r) => r.event_name === cell.provider_event_name && typeof r.value === 'number')
  if (!remote.length)
    return <span className="mt-1 block text-[11px] text-muted-foreground">Aucune ligne rapportée</span>
  const total = remote.reduce((sum, r) => sum + Number(r.value), 0)
  return (
    <span className="mt-1 block text-[11px] text-muted-foreground" title={section.message}>
      Relu : {section.state === 'partial' ? '≥ ' : ''}
      {n(total)} ·{' '}
      {destination === 'meta_capi'
        ? `${cell.provider_event_name}, pixel entier`
        : 'rapport journalier, propriété entière'}
      {destination === 'meta_capi' ? <span className="block">Période Meta, voir sources</span> : null}
    </span>
  )
}
function readState(section: EvidenceSection) {
  if (section.state === 'not_configured') return 'Lecture à configurer'
  if (section.state === 'permission_denied') return 'Accès de lecture refusé'
  if (section.state === 'rate_limited') return 'Quota API atteint'
  return 'Lecture indisponible'
}
