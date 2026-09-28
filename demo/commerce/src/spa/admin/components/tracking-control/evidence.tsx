import { Badge, Card, CardContent, CardHeader, CardTitle } from '@mantajs/ui'
import type { EvidenceSection, EvidenceState } from '../../../../modules/tracking-control/types'

export function formatCount(value: number) {
  return new Intl.NumberFormat('fr-FR').format(value)
}

export function formatTime(value: string | null) {
  if (!value) return 'Non disponible'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)} (date)`
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return `${new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date)} UTC`
}

const states: Record<EvidenceState, string> = {
  available: 'Données disponibles',
  partial: 'Données partielles',
  not_configured: 'Configuration requise',
  permission_denied: 'Autorisation requise',
  rate_limited: 'Limite de requêtes atteinte',
  unavailable: 'Indisponible',
  error: 'Lecture en échec',
}

export function RemoteEvidence({ section }: { section: EvidenceSection }) {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{section.title}</CardTitle>
          <Badge variant="outline">{states[section.state]}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{section.message}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-muted-foreground">Origine des données</dt>
            <dd className="break-words">{section.provenance}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">Précision temporelle</dt>
            <dd className="break-words">{section.granularity}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">Période effective de ce rapport</dt>
            <dd>
              {section.window ? (
                <>
                  {formatTime(section.window.from)} → {formatTime(section.window.to)}
                  <span className="block text-xs text-muted-foreground">
                    Fuseau du rapport : {section.window.timezone}
                  </span>
                </>
              ) : (
                'Non fournie par la plateforme'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Dernière lecture de la plateforme</dt>
            <dd>{formatTime(section.fetched_at)}</dd>
          </div>
        </dl>
        {section.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-left text-sm">
              <caption className="sr-only">{section.title} : mesures retournées par la plateforme</caption>
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 font-medium">Événement / périmètre</th>
                  <th className="py-2 pr-4 font-medium">Mesure</th>
                  <th className="py-2 pr-4 font-medium">Valeur</th>
                  <th className="py-2 font-medium">Précisions</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={`${row.event_name}-${row.label}-${row.detail || ''}`} className="border-b last:border-0">
                    <td className="max-w-64 break-words py-3 pr-4">{row.event_name || 'Ensemble'}</td>
                    <td className="max-w-64 break-words py-3 pr-4">{row.label}</td>
                    <td className="max-w-64 break-words py-3 pr-4 font-medium tabular-nums">
                      {row.value === null ? (
                        <span className="font-normal text-muted-foreground">Inconnu</span>
                      ) : typeof row.value === 'number' ? (
                        formatCount(row.value)
                      ) : (
                        row.value
                      )}
                    </td>
                    <td className="max-w-96 break-words py-3 text-muted-foreground">{row.detail || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
            Aucune mesure affichable. Cela ne signifie pas que la plateforme a reçu zéro événement.
          </p>
        )}
        {section.limitations.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {section.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        ) : null}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Source de la vérification</summary>
          <p className="mt-2 break-all">{section.source}</p>
        </details>
      </CardContent>
    </Card>
  )
}
