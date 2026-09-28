import { Card, CardContent, CardHeader, CardTitle } from '@mantajs/ui'
import type { ControlDestination, LocalControl } from '../../../../modules/tracking-control/types'
import { formatCount, formatTime } from './evidence'

const statusLabels: Record<string, string> = {
  pending: 'En attente',
  sending: 'En cours',
  sent: 'Réponse positive',
  validated: 'Validation seule',
  invalid: 'Invalide',
  error: 'Erreur',
  retry: 'À réessayer',
  not_configured: 'Non configuré',
}

function statusLabel(status: string, destination: ControlDestination) {
  if (status === 'sent' && destination !== 'ga4') return 'Accepté à l’envoi'
  return statusLabels[status] || status
}

export function LocalEvidence({ local, destination }: { local: LocalControl; destination: ControlDestination }) {
  const total = (field: 'captured' | 'eligible' | 'excluded' | 'unknown_eligibility' | 'missing_dispatch') =>
    local.rows.reduce((sum, row) => sum + row[field], 0)
  const sentTotal = local.sent_in_window.reduce((sum, row) => sum + row.count, 0)
  const grouped = new Map<string, { events: string[]; count: number }>()
  for (const row of local.sent_in_window) {
    const name = row.provider_event_name || 'Nom destination inconnu'
    const group = grouped.get(name) || { events: [], count: 0 }
    if (!group.events.includes(row.event_name)) group.events.push(row.event_name)
    group.count += row.count
    grouped.set(name, group)
  }
  const statuses = [
    ...new Set([...Object.keys(statusLabels), ...local.rows.flatMap((row) => Object.keys(row.statuses))]),
  ]
  const cards = [
    { label: 'Reçus dans le CRM', value: total('captured'), detail: 'Événements de la période sélectionnée' },
    { label: 'Éligibles à cette destination', value: total('eligible'), detail: 'Selon les règles enregistrées' },
    { label: 'Exclus', value: total('excluded'), detail: 'Ne sont pas des envois perdus' },
    { label: 'Éligibilité inconnue', value: total('unknown_eligibility'), detail: 'Préparation absente ou incomplète' },
    { label: 'Envois sans trace', value: total('missing_dispatch'), detail: 'Éligibles, sans suivi de livraison' },
  ]
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">{formatCount(card.value)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{card.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Événements reçus dans la période · état actuel</CardTitle>
          <p className="text-sm text-muted-foreground">
            Source : journal du CRM. Chaque événement compte une fois, même après plusieurs tentatives. Les statuts
            décrivent la situation au moment de la lecture, pas à la fin de la période.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {local.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1250px] text-left text-sm">
                <caption className="sr-only">Éligibilité et statuts actuels par événement CRM</caption>
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    {[
                      'Événement CRM',
                      'Nom destination',
                      'Reçus',
                      'Éligibles',
                      'Exclus',
                      'Éligibilité inconnue',
                      'Sans trace',
                      ...statuses.map((status) => statusLabel(status, destination)),
                    ].map((label) => (
                      <th key={label} className="py-2 pr-4 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {local.rows.map((row) => (
                    <tr key={row.event_name} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">{row.event_name}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{row.provider_event_name || 'Non disponible'}</td>
                      <td className="py-3 pr-4 tabular-nums">{formatCount(row.captured)}</td>
                      <td className="py-3 pr-4 tabular-nums">{formatCount(row.eligible)}</td>
                      <td className="py-3 pr-4 tabular-nums">{formatCount(row.excluded)}</td>
                      <td className="py-3 pr-4 tabular-nums">{formatCount(row.unknown_eligibility)}</td>
                      <td className="py-3 pr-4 tabular-nums">{formatCount(row.missing_dispatch)}</td>
                      {statuses.map((status) => (
                        <td key={status} className="py-3 pr-4 tabular-nums">
                          {formatCount(row.statuses[status] || 0)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun événement CRM dans cette période.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Une réponse positive ne prouve pas une conversion publicitaire. Les modes de test ou de validation ne
            prouvent pas une collecte en production. Pour GA4, une réponse positive peut aussi venir de la validation.
          </p>
          {local.limitations.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {local.limitations.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Envois aboutis pendant la période · {formatCount(sentTotal)}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Sélection par heure d’envoi, regroupée selon le nom utilisé chez la destination. Ces événements peuvent
            avoir été reçus dans le CRM avant la période. Le statut d’envoi ne prouve pas le traitement final.
          </p>
        </CardHeader>
        <CardContent>
          {grouped.size ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] text-left text-sm">
                <caption className="sr-only">Envois avec réponse positive par nom d’événement destination</caption>
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Nom destination</th>
                    <th className="py-2 pr-4 font-medium">Événements CRM regroupés</th>
                    <th className="py-2 font-medium">Envois aboutis</th>
                  </tr>
                </thead>
                <tbody>
                  {[...grouped].map(([name, group]) => (
                    <tr key={name} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">{name}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{group.events.join(', ')}</td>
                      <td className="py-3 tabular-nums">{formatCount(group.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun envoi abouti enregistré pendant cette période.</p>
          )}
        </CardContent>
      </Card>
    </>
  )
}

const receiptLabels = {
  acknowledged: 'Réception confirmée à l’envoi',
  validation_only: 'Validation seule',
  http_response: 'Réponse HTTP seulement',
  unknown: 'Preuve non disponible',
}

export function RecentReceipts({ local, destination }: { local: LocalControl; destination: ControlDestination }) {
  const recent = local.recent.slice(0, 50)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dernières traces de livraison</CardTitle>
        <p className="text-sm text-muted-foreground">
          {formatCount(recent.length)} affichées sur {formatCount(local.receipt_count)} traces de la période. Limite :{' '}
          {Math.min(local.recent_limit, 50)}. Détails conservés jusqu’à {local.detail_retention_hours} h.
        </p>
        {local.receipt_count > recent.length ? (
          <p className="text-sm text-muted-foreground">
            Liste partielle : les totaux ci-dessus portent sur toute la période.
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        {recent.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <caption className="sr-only">Traces récentes sans données client</caption>
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  {[
                    'Événement / identifiant',
                    'Statut / preuve',
                    'Tentatives',
                    'Reçu au CRM',
                    'Dernière tentative',
                    'Envoi abouti',
                    'Réponse',
                  ].map((label) => (
                    <th key={label} className="py-2 pr-4 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((receipt) => (
                  <tr key={receipt.event_id} className="border-b align-top last:border-0">
                    <td className="max-w-64 py-3 pr-4">
                      <p className="font-medium">{receipt.event_name}</p>
                      <p className="mt-1 break-all font-mono text-xs text-muted-foreground select-all">
                        {receipt.event_id}
                      </p>
                    </td>
                    <td className="py-3 pr-4">
                      <p>{statusLabel(receipt.status, destination)}</p>
                      <p className="text-xs text-muted-foreground">{receiptLabels[receipt.receipt_kind]}</p>
                      {!receipt.details_available ? (
                        <p className="text-xs text-muted-foreground">Détails absents ou compactés</p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 tabular-nums">{formatCount(receipt.attempt_count)}</td>
                    <td className="py-3 pr-4 text-xs">{formatTime(receipt.received_at)}</td>
                    <td className="py-3 pr-4 text-xs">{formatTime(receipt.last_attempt_at)}</td>
                    <td className="py-3 pr-4 text-xs">{formatTime(receipt.sent_at)}</td>
                    <td className="max-w-56 py-3 text-xs">
                      <p>{receipt.http_status === null ? 'Pas de réponse HTTP' : `HTTP ${receipt.http_status}`}</p>
                      {receipt.error_code ? <p className="mt-1 break-all">{receipt.error_code}</p> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Aucune trace de livraison à afficher.</p>
        )}
      </CardContent>
    </Card>
  )
}
