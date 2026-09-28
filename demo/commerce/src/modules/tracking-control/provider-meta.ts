import { getMetaCapiConfig } from '../event-hub/meta-capi-connector'
import {
  bearer,
  eventName,
  evidence,
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
import type { EvidenceSection, ProviderReadInput, ProviderReadResult } from './types'

// https://github.com/facebookincubator/catalogue-of-api-solutions/blob/main/solutions/signals/signals-health-dashboard.md
export async function readMeta(
  input: ProviderReadInput,
  env: NodeJS.ProcessEnv,
  fetcher: typeof fetch,
): Promise<ProviderReadResult> {
  const config = getMetaCapiConfig(env)
  const pixel = identifier(config.pixelId)
  const token = env.META_READ_ACCESS_TOKEN || config.accessToken
  const account = identifier(env.META_AD_ACCOUNT_ID?.replace(/^act_/, ''))
  const version = /^v\d{1,3}\.\d{1,2}$/.test(config.apiVersion) ? config.apiVersion : 'v25.0'
  const baseUrl = `https://graph.facebook.com/${version}`
  const remote = async (path: string, params: Record<string, string>) => {
    const url = new URL(`${baseUrl}/${path}`)
    url.search = new URLSearchParams(params).toString()
    const payload = object(await readJson(url, bearer(token || ''), fetcher))
    if (payload.error) {
      // Graph sometimes returns logical errors with HTTP 200; never relay messages.
      const code = number(object(payload.error).code)
      if (code === 10 || code === 190 || code === 200)
        throw new ReadError(
          'permission_denied',
          'Accès de lecture Meta refusé. Vérifier les droits et la validité du token.',
        )
      if (code === 4 || code === 17 || code === 32 || code === 613)
        throw new ReadError('rate_limited', 'Quota de lecture Meta atteint. Réessayer plus tard.')
      malformed()
    }
    return payload
  }
  const stats = async (key: string, title: string, source: string, aggregation = 'event') => {
    const base = section(key, title, 'Meta Pixel Stats API')
    base.granularity = 'Agrégats Meta ; bornes des tranches indiquées si disponibles'
    base.provenance =
      source === 'WEB_ONLY' ? 'Tous les expéditeurs navigateur du pixel' : 'Tous les expéditeurs serveur du pixel'
    base.limitations = [
      'Les volumes peuvent inclure Shopify ou d’autres intégrations. Aucun rapprochement individuel par event_id.',
      'Les tranches Meta et leur délai de mise à jour peuvent différer de la fenêtre horaire du CRM.',
    ]
    if (!pixel || !token)
      return missing(
        base,
        'Configurer META_PIXEL_ID et un accès de lecture Meta (META_READ_ACCESS_TOKEN ou token CAPI existant).',
      )
    return evidence(base, async () => {
      const data = await remote(`${pixel}/stats`, {
        aggregation,
        event_source: source,
        start_time: String(Math.floor(new Date(input.window.from).getTime() / 1000)),
        end_time: String(Math.floor(new Date(input.window.to).getTime() / 1000)),
      })
      if (!Array.isArray(data.data)) malformed()
      const totals = new Map<string, { event: string; label: string; count: number }>()
      let invalid = false
      let truncated = data.data.length > 2000
      const starts: number[] = []
      const ends: number[] = []
      for (const raw of data.data.slice(0, 2000)) {
        const bucket = object(raw)
        if (!Array.isArray(bucket.data)) {
          invalid = true
          continue
        }
        const start = typeof bucket.start_time === 'string' ? Date.parse(bucket.start_time) : NaN
        const end = typeof bucket.end_time === 'string' ? Date.parse(bucket.end_time) : NaN
        if (Number.isFinite(start)) starts.push(start)
        if (Number.isFinite(end)) ends.push(end)
        truncated ||= bucket.data.length > 1000
        for (const rawEntry of bucket.data.slice(0, 1000)) {
          const entry = object(rawEntry)
          const name = eventName(entry.event) || eventName(entry.value)
          const count = number(entry.count)
          const result = aggregation === 'event_processing_results' ? eventName(entry.value) : null
          if (!name || count === null) {
            invalid = true
            continue
          }
          const label =
            result && result !== name
              ? result
              : aggregation === 'event'
                ? 'Événements rapportés'
                : 'Résultat de traitement agrégé'
          const key = `${name}:${label}`
          const previous = totals.get(key)
          totals.set(key, { event: name, label, count: (previous?.count || 0) + count })
        }
      }
      if (invalid && totals.size === 0) malformed()
      const partial = Boolean(object(data.paging).next) || invalid || truncated || totals.size > 200
      const actualWindow =
        starts.length === data.data.length && ends.length === data.data.length && starts.length
          ? {
              from: new Date(Math.min(...starts)).toISOString(),
              to: new Date(Math.max(...ends)).toISOString(),
              timezone: 'UTC',
            }
          : null
      return {
        ...base,
        window: actualWindow,
        state: partial ? 'partial' : 'available',
        message: partial
          ? 'Lecture partielle : pagination ou lignes non interprétables. Aucun total exhaustif confirmé.'
          : totals.size
            ? 'Statistiques relues auprès de Meta. Origine CRM exclusive non démontrée.'
            : 'Aucune ligne rapportée par Meta ; cela ne prouve pas une absence d’envoi.',
        rows: [...totals.values()]
          .slice(0, 200)
          .map((row) => ({ event_name: row.event, label: row.label, value: row.count })),
      }
    })
  }
  const qualityBase = section('meta_quality', 'Qualité des événements', 'Meta Dataset Quality API')
  qualityBase.granularity = 'État de qualité actuel ; période non sélectionnable'
  qualityBase.provenance = 'Dataset complet, tous expéditeurs'
  qualityBase.limitations = [
    'Un score de correspondance ne prouve ni réception exhaustive ni attribution publicitaire.',
  ]
  const quality =
    !pixel || !token
      ? Promise.resolve(missing(qualityBase, 'Configurer le pixel et un token autorisé à lire Dataset Quality.'))
      : evidence(qualityBase, async () => {
          const data = await remote('dataset_quality', {
            dataset_id: pixel,
            fields: 'web{event_name,event_match_quality,event_coverage,dedupe_key_feedback,data_freshness}',
          })
          if (!Array.isArray(data.web)) malformed()
          const rows: EvidenceSection['rows'] = []
          let invalid = false
          for (const raw of data.web.slice(0, 100)) {
            const entry = object(raw)
            const name = eventName(entry.event_name)
            if (!name) {
              invalid = true
              continue
            }
            const score = number(object(entry.event_match_quality).composite_score)
            if (score !== null && score <= 10)
              rows.push({ event_name: name, label: 'Qualité de correspondance / 10', value: score })
            const coverage = number(object(entry.event_coverage).percentage)
            if (coverage !== null && coverage <= 100)
              rows.push({ event_name: name, label: 'Couverture serveur (%)', value: coverage })
            const frequency = object(entry.data_freshness).upload_frequency
            if (frequency === 'real_time' || frequency === 'hourly' || frequency === 'daily')
              rows.push({ event_name: name, label: 'Fréquence d’envoi', value: frequency })
            const diagnostics = list(object(entry.event_match_quality).diagnostics)
            if (diagnostics.length)
              rows.push({ event_name: name, label: 'Diagnostics à consulter dans Meta', value: diagnostics.length })
          }
          return {
            ...qualityBase,
            state: invalid || data.web.length > 100 || rows.length > 200 ? 'partial' : 'available',
            rows: rows.slice(0, 200),
            message: rows.length
              ? 'Indicateurs de qualité relus auprès de Meta.'
              : 'Aucun indicateur de qualité exploitable retourné.',
          }
        })
  const adsBase = section('meta_ads', 'Attribution publicitaire', 'Meta Ads Insights API')
  adsBase.granularity = 'Journées calendaires du compte publicitaire'
  adsBase.provenance = 'Compte publicitaire complet ; pas exclusivement ce pixel ou le CRM'
  adsBase.limitations = [
    'Conversions attribuées selon les règles Meta, distinctes des événements reçus.',
    'Période journalière différente de la sélection horaire ; fuseau du compte non confirmé.',
    'Ne démontre pas l’utilisation de chaque événement dans l’algorithme publicitaire.',
  ]
  const ads =
    !account || !token
      ? Promise.resolve(
          missing(adsBase, 'Configurer META_AD_ACCOUNT_ID et un token autorisé à lire les statistiques publicitaires.'),
        )
      : evidence(adsBase, async () => {
          const since = input.window.from.slice(0, 10)
          const until = new Date(Date.parse(input.window.to) - 1).toISOString().slice(0, 10)
          const data = await remote(`act_${account}/insights`, {
            fields: 'date_start,date_stop,actions',
            time_range: JSON.stringify({ since, until }),
            time_increment: '1',
            level: 'account',
            limit: '100',
          })
          if (!Array.isArray(data.data)) malformed()
          const rows: EvidenceSection['rows'] = []
          let invalid = false
          for (const raw of data.data.slice(0, 100)) {
            const day = object(raw)
            const date =
              typeof day.date_start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date_start) ? day.date_start : null
            for (const rawAction of list(day.actions).slice(0, 100)) {
              const action = object(rawAction)
              const name = eventName(action.action_type)
              const value = number(action.value)
              if (!name || value === null || !date) {
                invalid = true
                continue
              }
              rows.push({ event_name: name, label: `Actions attribuées · ${date}`, value })
            }
          }
          return {
            ...adsBase,
            state:
              object(data.paging).next || invalid || data.data.length > 100 || rows.length > 200
                ? 'partial'
                : 'available',
            window: { from: since, to: until, timezone: 'Fuseau du compte Meta non confirmé (dates inclusives)' },
            rows: rows.slice(0, 200),
            message:
              'Actions publicitaires rapportées par Meta pour les journées sélectionnées. Ces chiffres ne mesurent pas la réception du CRM.',
          }
        })
  return {
    config: {
      identifiers: [
        { label: 'Pixel / Dataset ID', value: pixel },
        { label: 'Version API', value: version },
        { label: 'Compte publicitaire', value: account },
      ],
      send_configured: Boolean(pixel && config.accessToken),
      current_mode: config.testEventCode ? 'Mode actuel : test Meta' : 'Mode actuel : collecte Meta',
      setup: [
        'META_PIXEL_ID',
        'META_READ_ACCESS_TOKEN (facultatif ; sinon token CAPI)',
        'META_AD_ACCOUNT_ID (attribution publicitaire facultative)',
      ],
    },
    sections: await Promise.all([
      stats('meta_server', 'Événements serveur', 'SERVER_ONLY'),
      stats('meta_browser', 'Événements navigateur', 'WEB_ONLY'),
      stats('meta_processing', 'Traitement serveur', 'SERVER_ONLY', 'event_processing_results'),
      quality,
      ads,
    ]),
  }
}
