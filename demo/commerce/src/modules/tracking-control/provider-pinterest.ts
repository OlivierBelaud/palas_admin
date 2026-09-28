import { getPinterestConfig } from '../event-hub/pinterest-connector'
import {
  bearer,
  eventName,
  evidence,
  identifier,
  malformed,
  missing,
  number,
  object,
  readJson,
  section,
} from './provider-http'
import type { EvidenceRow, ProviderReadResult } from './types'

// https://github.com/pinterest/api-description/blob/main/v5/openapi.yaml
const COMPONENTS: Record<string, string> = {
  advertiser_external_id: 'Identifiant externe',
  click_id_epik: 'Identifiant de clic',
  external_event_id: 'Identifiant de déduplication',
  hashed_email: 'Email haché',
  hashed_maid: 'Identifiant mobile haché',
  ip_address: 'Adresse IP',
  order_id: 'Identifiant de commande',
  order_value: 'Valeur de commande',
  product_id: 'Identifiant produit',
  source_url: 'URL source',
  user_agent: 'Navigateur',
}
export async function readPinterest(env: NodeJS.ProcessEnv, fetcher: typeof fetch): Promise<ProviderReadResult> {
  const config = getPinterestConfig(env)
  const account = identifier(config.adAccountId)
  const base = section('pinterest_quality', 'Qualité des événements serveur', 'Pinterest · conversion_eqs')
  base.granularity = 'Qualité sur 1 jour (fenêtre Pinterest, ancrage exact non retourné)'
  base.provenance = 'Compte Pinterest · WEB / CONVERSIONS_API ; tous expéditeurs serveur'
  base.limitations = [
    'L’API retourne de la qualité, pas un registre des événements reçus.',
    'Fenêtre de 1 jour imposée par cette lecture ; indépendante des heures sélectionnées dans le CRM.',
    'Aucune attribution publicitaire ou origine CRM exclusive démontrée.',
  ]
  const result: ProviderReadResult = {
    config: {
      identifiers: [{ label: 'Compte publicitaire Pinterest', value: account }],
      send_configured: Boolean(account && config.accessToken),
      current_mode: config.testMode
        ? 'Mode actuel : test Pinterest, sans collecte'
        : 'Mode actuel : collecte Pinterest',
      setup: ['PINTEREST_AD_ACCOUNT_ID', 'PINTEREST_ACCESS_TOKEN avec permission ads:read'],
    },
    sections: [],
  }
  if (!account || !config.accessToken) {
    result.sections = [missing(base, 'Configurer le compte Pinterest et un token avec accès ads:read.')]
    return result
  }
  result.sections = [
    await evidence(base, async () => {
      const url = new URL(`https://api.pinterest.com/v5/ad_accounts/${account}/conversion_eqs`)
      url.search = new URLSearchParams({
        lookback_period: '1d',
        source_platform: 'WEB',
        ingestion_source: 'CONVERSIONS_API',
      }).toString()
      const data = await readJson(url, bearer(config.accessToken!), fetcher)
      if (!Array.isArray(data)) malformed()
      const rows: EvidenceRow[] = []
      let invalid = data.length > 20
      for (const raw of data.slice(0, 20)) {
        const entry = object(raw)
        if (
          entry.ingestion_source !== 'CONVERSIONS_API' ||
          entry.source_platform !== 'WEB' ||
          entry.lookback_period !== '1d'
        ) {
          invalid = true
          continue
        }
        if (typeof entry.quality_components !== 'object' || entry.quality_components === null) {
          invalid = true
          continue
        }
        if (
          entry.overall_status === 'GOOD' ||
          entry.overall_status === 'FAIR' ||
          entry.overall_status === 'NEEDS_IMPROVEMENT'
        ) {
          rows.push({
            event_name: 'Tous les événements serveur',
            label: 'Qualité globale',
            value: entry.overall_status,
          })
        }
        for (const [key, label] of Object.entries(COMPONENTS)) {
          const events = Object.entries(object(object(entry.quality_components)[key]))
          invalid ||= events.length > 50
          for (const [rawName, rawDetails] of events.slice(0, 50)) {
            const name = eventName(rawName)
            const details = object(rawDetails)
            const coverage = number(details.coverage)
            if (!name || coverage === null || coverage > 100) {
              invalid = true
              continue
            }
            rows.push({ event_name: name, label: `${label} · couverture (%)`, value: coverage })
            const overlap = number(details.overlap)
            if (key === 'external_event_id' && overlap !== null && overlap <= 100)
              rows.push({ event_name: name, label: 'Identifiant de déduplication · chevauchement (%)', value: overlap })
            if (Array.isArray(details.issues) && details.issues.length)
              rows.push({
                event_name: name,
                label: `${label} · problèmes signalés`,
                value: details.issues.length,
                detail: 'Consulter les détails dans Pinterest Events Manager.',
              })
          }
        }
      }
      if (invalid && !rows.length && data.length) malformed()
      return {
        ...base,
        state: invalid || rows.length > 200 ? 'partial' : 'available',
        rows: rows.slice(0, 200),
        message: rows.length
          ? 'Couverture des informations et qualité relues auprès de Pinterest ; ces chiffres ne sont pas des volumes reçus.'
          : 'Aucun indicateur de qualité retourné. Cela ne prouve pas une absence d’événements.',
      }
    }),
  ]
  return result
}
