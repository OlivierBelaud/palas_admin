import { Card, CardContent, CardHeader, CardTitle } from '@mantajs/ui'
import type { TrackingControlData } from '../../../../modules/tracking-control/types'
import { formatCount } from './evidence'

export function MetaComparison({ data }: { data: TrackingControlData }) {
  if (data.destination !== 'meta_capi') return null
  const server = data.remote.find((section) => section.key === 'meta_server')
  const ours = new Map<string, number>()
  for (const row of data.local.sent_in_window) {
    if (row.provider_event_name) ours.set(row.provider_event_name, (ours.get(row.provider_event_name) ?? 0) + row.count)
  }
  const remote = new Map<string, number>()
  for (const row of server?.rows ?? []) {
    if (row.label === 'Événements rapportés' && typeof row.value === 'number') remote.set(row.event_name, row.value)
  }
  const unavailable =
    server?.state === 'permission_denied'
      ? 'Accès de lecture refusé'
      : server?.state === 'not_configured'
        ? 'Lecture à configurer'
        : server?.state === 'available'
          ? 'Non rapporté par Meta'
          : 'Lecture indisponible'
  const names = [...new Set([...ours.keys(), ...remote.keys()])].sort()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nos envois et la réception Meta</CardTitle>
        <p className="text-sm text-muted-foreground">
          Comparaison indicative : Meta peut inclure d’autres expéditeurs et utiliser des tranches horaires différentes.
          Une égalité ne prouve pas que chaque événement du CRM a été traité.
        </p>
      </CardHeader>
      <CardContent>
        {server && !['available', 'partial'].includes(server.state) ? (
          <p role="status" className="mb-3 text-sm text-amber-800">
            {server.message} Les accusés de réception restent consultables dans le tableau de contrôle Tracking.
          </p>
        ) : null}
        {names.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-left text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Événement Meta</th>
                  <th className="py-2 pr-3">Nos envois acceptés dans la période</th>
                  <th className="py-2">Serveur rapporté par Meta</th>
                </tr>
              </thead>
              <tbody>
                {names.map((name) => (
                  <tr key={name} className="border-b last:border-0">
                    <td className="py-3 pr-3 font-medium">{name}</td>
                    <td className="py-3 pr-3 tabular-nums">{formatCount(ours.get(name) ?? 0)}</td>
                    <td className="py-3 tabular-nums">
                      {remote.has(name) ? formatCount(remote.get(name)!) : unavailable}
                      {server?.state === 'partial' && remote.has(name) ? ' (partiel)' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Pas encore de volumes à rapprocher sur cette sélection.</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Les modes de test ne prouvent pas une collecte en production. Les périodes et sources distantes sont
          détaillées ci-dessous.
        </p>
      </CardContent>
    </Card>
  )
}
