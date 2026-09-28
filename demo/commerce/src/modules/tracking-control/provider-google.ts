import { getGa4Config, isGa4Configured } from '../event-hub/ga4-connector'
import { conversionActionIdFor, getGoogleAdsConfig } from '../event-hub/google-ads-connector'
import {
  bearer,
  eventName,
  evidence,
  googleToken,
  identifier,
  list,
  malformed,
  missing,
  number,
  object,
  ReadError,
  readJson,
  section,
} from './provider-http'
import type { EvidenceRow, ProviderReadInput, ProviderReadResult } from './types'

const STATUSES = new Set(['SUCCESS', 'PROCESSING', 'FAILED', 'PARTIAL_SUCCESS', 'REQUEST_STATUS_UNKNOWN'])
const WARNING_REASONS = new Set([
  'UNSPECIFIED',
  'KEK_PERMISSION_DENIED',
  'DEK_DECRYPTION_ERROR',
  'DECRYPTION_ERROR',
  'WIP_AUTH_FAILED',
  'INVALID_WIP',
  'INVALID_KEK',
  'USER_IDENTIFIER_DECRYPTION_ERROR',
  'INTERNAL_ERROR',
  'AWS_AUTH_FAILED',
])
const ERROR_REASONS = new Set([
  'UNSPECIFIED',
  'INVALID_CUSTOM_VARIABLE',
  'CUSTOM_VARIABLE_NOT_ENABLED',
  'EVENT_TOO_OLD',
  'DENIED_CONSENT',
  'NO_CONSENT',
  'UNKNOWN_CONSENT',
  'DUPLICATE_GCLID',
  'DUPLICATE_TRANSACTION_ID',
  'INVALID_GBRAID',
  'INVALID_GCLID',
  'INVALID_WBRAID',
  'INVALID_MERCHANT_ID',
  'INTERNAL_ERROR',
  'DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED',
  'INVALID_EVENT',
  'INSUFFICIENT_MATCHED_TRANSACTIONS',
  'INSUFFICIENT_TRANSACTIONS',
  'INVALID_FORMAT',
  'CLICK_NOT_FOUND',
  'INVALID_CLICK',
  'TOO_RECENT_CLICK',
  'CONVERSION_PRECEDES_CLICK',
  'MATCH_ID_NOT_FOUND',
  'USER_ID_NOT_FOUND',
])

export async function readGoogleAds(
  input: ProviderReadInput,
  env: NodeJS.ProcessEnv,
  fetcher: typeof fetch,
): Promise<ProviderReadResult> {
  const config = getGoogleAdsConfig(env)
  const account = identifier(config.customerId)
  const base = section(
    'google_processing',
    'Traitement des envois',
    'Google Data Manager · requestStatus:retrieve',
    input.window,
  )
  base.granularity = 'Requêtes conservées du CRM ; état actuel du traitement'
  base.provenance = 'Request IDs issus des reçus du CRM uniquement'
  base.limitations = [
    'Les nombres ci-dessous comptent des requêtes, pas des conversions attribuées.',
    'Maximum 10 requêtes distinctes relues ; les réponses détaillées sont compactées après 24 h.',
    'La fenêtre sélectionne la réception CRM des événements, pas la date de traitement chez Google.',
    'Les identifiants de destination sont comparés à la configuration actuelle, qui peut avoir changé.',
  ]
  const configured = Boolean(account && config.clientId && config.clientSecret && config.refreshToken)
  const result: ProviderReadResult = {
    config: {
      identifiers: [{ label: 'Compte Google Ads', value: account }],
      send_configured: configured,
      current_mode: config.validateOnly ? 'Mode actuel : validation uniquement' : 'Mode actuel : ingestion Google Ads',
      setup: [
        'GOOGLE_ADS_CUSTOMER_ID',
        'GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_REFRESH_TOKEN',
        'Autorisation OAuth Data Manager sur le compte',
      ],
    },
    sections: [],
  }
  if (!configured) {
    result.sections = [missing(base, 'Configurer le compte Google Ads et les accès OAuth Data Manager du connecteur.')]
    return result
  }
  const ids = [
    ...new Map(
      input.google_requests
        .filter((request) => /^[a-zA-Z0-9_.:~+/=-]{1,512}$/.test(request.request_id))
        .map((request) => [request.request_id, request]),
    ).values(),
  ].slice(0, 10)
  if (!ids.length) {
    result.sections = [
      {
        ...base,
        state: 'unavailable',
        message:
          'Aucun request ID conservé pour cette fenêtre. Le journal local reste disponible, mais le traitement distant ne peut pas être relu.',
      },
    ]
    return result
  }
  result.sections = [
    await evidence(base, async () => {
      const token = await googleToken(config.clientId!, config.clientSecret!, config.refreshToken!, fetcher)
      const rows = new Map<string, EvidenceRow>()
      const failures: ReadError[] = []
      let checked = 0
      let destinationUnspecified = false
      const add = (name: string, label: string, count: number, detail?: string) => {
        const key = `${name}:${label}`
        rows.set(key, {
          event_name: name,
          label,
          value: Number(rows.get(key)?.value || 0) + count,
          ...(detail ? { detail } : {}),
        })
      }
      const read = async (request: (typeof ids)[number]) => {
        try {
          const url = new URL('https://datamanager.googleapis.com/v1/requestStatus:retrieve')
          url.searchParams.set('requestId', request.request_id)
          const payload = object(await readJson(url, bearer(token), fetcher))
          if (!Array.isArray(payload.requestStatusPerDestination)) malformed()
          const all = payload.requestStatusPerDestination.map(object)
          // Missing destination is usable only for a single returned status: the
          // current connector uploads exactly one destination per request.
          const matching = all.filter((entry) => {
            const destination = object(entry.destination)
            if (!Object.keys(destination).length) return all.length === 1
            const operating = object(destination.operatingAccount)
            return (
              operating.accountType === 'GOOGLE_ADS' &&
              operating.accountId === account &&
              (!destination.productDestinationId ||
                destination.productDestinationId === conversionActionIdFor(request.event_name, config))
            )
          })
          if (matching.length !== 1) malformed()
          const entry = matching[0]
          if (typeof entry.requestStatus !== 'string' || !STATUSES.has(entry.requestStatus)) malformed()
          destinationUnspecified ||= !Object.keys(object(entry.destination)).length
          const name = eventName(request.event_name) || 'Événement CRM'
          add(name, entry.requestStatus, 1, 'Nombre de requêtes')
          for (const [infoKey, countsKey, prefix, allowed, label] of [
            ['errorInfo', 'errorCounts', 'PROCESSING_ERROR_REASON_', ERROR_REASONS, 'Erreur'],
            ['warningInfo', 'warningCounts', 'PROCESSING_WARNING_REASON_', WARNING_REASONS, 'Avertissement'],
          ] as const) {
            for (const raw of list(object(entry[infoKey])[countsKey]).slice(0, 30)) {
              const warning = object(raw)
              const count = number(warning.recordCount)
              if (count === null) continue
              const reason =
                typeof warning.reason === 'string' && warning.reason.startsWith(prefix)
                  ? warning.reason.slice(prefix.length)
                  : ''
              add(
                name,
                `${label} : ${allowed.has(reason) ? reason : 'AUTRE_CODE'}`,
                count,
                'Nombre d’enregistrements concernés ; plusieurs motifs peuvent concerner un même enregistrement',
              )
            }
          }
          checked++
        } catch (error) {
          failures.push(
            error instanceof ReadError ? error : new ReadError('error', 'Réponse de statut non interprétable.'),
          )
        }
      }
      // Three workers, never ten simultaneous requests.
      let next = 0
      await Promise.all(
        Array.from({ length: Math.min(3, ids.length) }, async () => {
          while (next < ids.length) {
            const request = ids[next++]
            await read(request)
          }
        }),
      )
      if (!checked && failures.length) throw failures[0]
      const total = Math.max(input.google_request_count, input.google_requests.length)
      const partial = failures.length > 0 || checked < total || destinationUnspecified
      return {
        ...base,
        state: partial ? 'partial' : 'available',
        rows: [...rows.values()],
        message: `${checked} / ${total} requêtes conservées relues. ${failures.length ? `${failures.length} lectures ont échoué. ` : ''}Le statut SUCCESS confirme le traitement, pas l’attribution publicitaire.`,
        limitations: [
          ...base.limitations,
          ...(destinationUnspecified
            ? [
                'Google n’a pas précisé la destination dans certaines réponses ; rattachement fondé sur le request ID local à destination unique.',
              ]
            : []),
        ],
      }
    }),
  ]
  return result
}

export async function readGa4(
  input: ProviderReadInput,
  env: NodeJS.ProcessEnv,
  fetcher: typeof fetch,
): Promise<ProviderReadResult> {
  const config = getGa4Config(env)
  const property = identifier(env.GA4_PROPERTY_ID)
  const measurement =
    typeof config.measurementId === 'string' && /^G-[A-Z0-9]{1,30}$/.test(config.measurementId)
      ? config.measurementId
      : null
  const base = section('ga4_report', 'Événements rapportés', 'Google Analytics Data API · runReport')
  base.granularity = 'Journées calendaires de la propriété GA4'
  base.provenance = 'Toute la propriété, tous flux et expéditeurs ; origine CRM non isolée'
  base.limitations = [
    'Ce rapport journalier ne correspond pas à la fenêtre horaire du CRM.',
    'Les rapports peuvent être retardés, filtrés ou soumis à des seuils. Aucun accusé de réception individuel.',
    'Le secret Measurement Protocol autorise l’envoi, pas la lecture des rapports.',
  ]
  const result: ProviderReadResult = {
    config: {
      identifiers: [
        { label: 'Measurement ID', value: measurement },
        { label: 'Propriété GA4', value: property },
      ],
      send_configured: isGa4Configured(config),
      current_mode: config.debug
        ? 'Mode actuel : validation GA4 (debug, sans collecte)'
        : 'Mode actuel : collecte GA4 (réponse HTTP sans preuve de traitement)',
      setup: [
        'GA4_PROPERTY_ID',
        'GA4_READ_ACCESS_TOKEN ou GA4_OAUTH_CLIENT_ID / GA4_OAUTH_CLIENT_SECRET / GA4_OAUTH_REFRESH_TOKEN',
        'Accès en lecture à la propriété et scope analytics.readonly',
      ],
    },
    sections: [],
  }
  const oauth = env.GA4_OAUTH_CLIENT_ID && env.GA4_OAUTH_CLIENT_SECRET && env.GA4_OAUTH_REFRESH_TOKEN
  if (!property || (!env.GA4_READ_ACCESS_TOKEN && !oauth)) {
    result.sections = [
      missing(
        base,
        'Configurer une propriété GA4 et des accès de lecture Data API distincts du secret Measurement Protocol.',
      ),
    ]
    return result
  }
  result.sections = [
    await evidence(base, async () => {
      const token =
        env.GA4_READ_ACCESS_TOKEN ||
        (await googleToken(
          env.GA4_OAUTH_CLIENT_ID!,
          env.GA4_OAUTH_CLIENT_SECRET!,
          env.GA4_OAUTH_REFRESH_TOKEN!,
          fetcher,
        ))
      const from = input.window.from.slice(0, 10)
      const to = new Date(Date.parse(input.window.to) - 1).toISOString().slice(0, 10)
      const payload = object(
        await readJson(
          new URL(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`),
          {
            ...bearer(token),
            headers: { ...bearer(token).headers, 'Content-Type': 'application/json' },
            method: 'POST',
            body: JSON.stringify({
              dateRanges: [{ startDate: from, endDate: to }],
              dimensions: [{ name: 'eventName' }],
              metrics: [{ name: 'eventCount' }],
              limit: '200',
            }),
          },
          fetcher,
        ),
      )
      const headers = list(payload.dimensionHeaders).map(object)
      const metrics = list(payload.metricHeaders).map(object)
      if (
        headers[0]?.name !== 'eventName' ||
        metrics[0]?.name !== 'eventCount' ||
        (payload.rows !== undefined && !Array.isArray(payload.rows))
      )
        malformed()
      const metadata = object(payload.metadata)
      let timezone = 'Fuseau de propriété non retourné'
      if (typeof metadata.timeZone === 'string') {
        try {
          new Intl.DateTimeFormat('fr', { timeZone: metadata.timeZone })
          timezone = metadata.timeZone
        } catch {
          /* do not relay malformed values */
        }
      }
      const rows: EvidenceRow[] = []
      let invalid = false
      for (const raw of list(payload.rows).slice(0, 200)) {
        const row = object(raw)
        const name = eventName(object(list(row.dimensionValues)[0]).value)
        const count = number(object(list(row.metricValues)[0]).value)
        if (!name || count === null) {
          invalid = true
          continue
        }
        rows.push({ event_name: name, label: 'Événements rapportés (journées entières)', value: count })
      }
      const sampling = list(metadata.samplingMetadatas).length > 0
      const threshold = metadata.subjectToThresholding === true
      const partial =
        invalid ||
        (number(payload.rowCount) ?? 0) > rows.length ||
        sampling ||
        threshold ||
        metadata.dataLossFromOtherRow === true
      return {
        ...base,
        state: partial ? 'partial' : 'available',
        rows,
        window: { from, to, timezone },
        message: `Rapport du ${from} au ${to} inclus, selon le fuseau de la propriété. Les dates UTC sélectionnées sont utilisées comme journées GA4 ; la fenêtre horaire exacte n’est pas reproduite.`,
        limitations: [
          ...base.limitations,
          ...(sampling ? ['Échantillonnage signalé par Google.'] : []),
          ...(threshold ? ['Seuils de confidentialité signalés par Google.'] : []),
        ],
      }
    }),
  ]
  return result
}
