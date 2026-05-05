// Pull 90-day performance for the 6 live abandonment flows, broken down
// by flow-message (so we see each email of the 3/4-step sequence
// individually). Writes a Markdown analysis to docs/klaviyo-abandon-perf-{today}.md.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const envLines = readFileSync(resolve(here, '..', '.env'), 'utf8').split('\n')
for (const line of envLines) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY!
if (!KLAVIYO_API_KEY) throw new Error('KLAVIYO_API_KEY missing')

const HOST = 'https://a.klaviyo.com'
const REVISION = '2024-10-15'

async function klaviyo<T = unknown>(path: string, init?: RequestInit, attempt = 1): Promise<T> {
  const res = await fetch(`${HOST}${path}`, {
    ...init,
    headers: {
      Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
      accept: 'application/json',
      'content-type': 'application/json',
      revision: REVISION,
      ...(init?.headers ?? {}),
    },
  })
  if (res.status === 429 && attempt <= 5) {
    // Klaviyo steady-state limit on reads is pretty tight. Back off +
    // retry up to 5 times — exponential with a little jitter.
    const wait = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200)
    await new Promise((r) => setTimeout(r, wait))
    return klaviyo<T>(path, init, attempt + 1)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Klaviyo ${path} → ${res.status} ${body.slice(0, 500)}`)
  }
  if (res.status === 204) return {} as T
  return (await res.json()) as T
}

const TARGET_FLOWS: {
  id: string
  name: string
  lang: 'FR' | 'EN'
  kind: 'cart' | 'checkout' | 'browse' | 'winback'
  note?: string
}[] = [
  { id: 'W4ruD9', name: '04 | Panier Abandonné', lang: 'FR', kind: 'cart', note: 'LIVE (nouveau)' },
  {
    id: 'TuJa5e',
    name: '04 | Panier Abandonné - old',
    lang: 'FR',
    kind: 'cart',
    note: "DRAFT — version précédente, contient l'historique",
  },
  { id: 'WL5Bc6', name: '030 | Panier Abandonné | B2C EN', lang: 'EN', kind: 'cart', note: 'LIVE' },
  { id: 'VGzPTF', name: '040 | Checkout Abandonné | B2C EN', lang: 'EN', kind: 'checkout', note: 'LIVE' },
  { id: 'WCcxfn', name: '020 | Navigation Abandonnée | B2C FR', lang: 'FR', kind: 'browse', note: 'LIVE' },
  { id: 'WHUTVf', name: '020 | Navigation Abandonnée | B2C EN', lang: 'EN', kind: 'browse', note: 'LIVE' },
  { id: 'RrYMuk', name: 'Winback - Last Cart was 2 months ago | B2C FR', lang: 'FR', kind: 'winback', note: 'LIVE' },
]

type MetricsListPage = {
  data: { id: string; attributes: { name: string; integration?: { name?: string } } }[]
  links?: { next?: string | null }
}

async function findPlacedOrderMetricId(): Promise<string> {
  // Klaviyo has TWO "Placed Order" metrics: one native-API (VW9xn5, doesn't
  // support report queries) and one from the Shopify integration (XGJSQC,
  // the canonical one for attribution). We specifically want the Shopify
  // integration version — `conversion_metric_id` on reports API only
  // accepts metrics that Klaviyo treats as "conversion-eligible".
  let url: string | null = '/api/metrics/'
  let firstMatch: string | null = null
  while (url) {
    const res: MetricsListPage = await klaviyo<MetricsListPage>(url)
    for (const m of res.data) {
      if (m.attributes.name !== 'Placed Order') continue
      if (m.attributes.integration?.name === 'Shopify') return m.id
      if (!firstMatch) firstMatch = m.id
    }
    const next: string | null = res.links?.next ?? null
    url = next ? next.replace(HOST, '') : null
  }
  if (firstMatch) return firstMatch
  throw new Error('Placed Order metric not found')
}

interface FlowAction {
  id: string
  attributes: { action_type: string; status?: string }
  relationships?: { 'flow-message'?: { data?: { id: string; type: string } | null } }
}

interface FlowMessage {
  id: string
  attributes: {
    name?: string
    content?: { subject?: string; preview_text?: string }
  }
}

async function listFlowEmailMessages(
  flowId: string,
): Promise<{ actionId: string; messageId: string; step: number; status: string; name: string; subject: string }[]> {
  const actionsRes = await klaviyo<{ data: FlowAction[] }>(`/api/flows/${flowId}/flow-actions/`)
  // Actions come back in execution order. Only keep SEND_EMAIL.
  // The flow-message(s) relationship is only a link in the default payload,
  // so we fetch via the dedicated endpoint /api/flow-actions/{id}/flow-messages/.
  const emails = actionsRes.data.filter((a) => a.attributes.action_type === 'SEND_EMAIL')
  const results: {
    actionId: string
    messageId: string
    step: number
    status: string
    name: string
    subject: string
  }[] = []
  for (let i = 0; i < emails.length; i++) {
    const a = emails[i]
    try {
      const msgRes = await klaviyo<{ data: FlowMessage[] }>(`/api/flow-actions/${a.id}/flow-messages/`)
      const m = msgRes.data[0]
      if (!m) continue
      results.push({
        actionId: a.id,
        messageId: m.id,
        step: i + 1,
        status: a.attributes.status ?? '?',
        name: m.attributes.name ?? '(unnamed)',
        subject: m.attributes.content?.subject ?? '(no subject)',
      })
    } catch (err) {
      console.warn(`  (flow-action ${a.id} messages fetch failed: ${(err as Error).message.slice(0, 100)})`)
    }
  }
  return results
}

interface ReportResult {
  flowMessageId: string
  stats: Record<string, number>
}

async function pullFlowValuesReport(
  flowIds: string[],
  conversionMetricId: string,
  timeframeKey: string,
): Promise<ReportResult[]> {
  // Klaviyo reports API: POST /api/flow-values-reports with filter, statistics,
  // conversion_metric_id, timeframe. Group by flow_message to get per-email rows.
  const body = {
    data: {
      type: 'flow-values-report',
      attributes: {
        statistics: [
          'recipients',
          'delivered',
          'opens_unique',
          'clicks_unique',
          'conversions',
          'conversion_uniques',
          'conversion_value',
          'unsubscribes',
          'bounced',
        ],
        timeframe: { key: timeframeKey },
        conversion_metric_id: conversionMetricId,
        filter: `contains-any(flow_id,[${flowIds.map((id) => `"${id}"`).join(',')}])`,
        // Klaviyo requires flow_id in the grouping (even when we really
        // want per-message data). The field is singular `group_by` but
        // takes an array; adding `flow_message_id` yields per-email rows.
        group_by: ['flow_id', 'flow_message_id'],
      },
    },
  }
  const res = await klaviyo<{
    data: { attributes: { results: { groupings: Record<string, string>; statistics: Record<string, number> }[] } }
  }>('/api/flow-values-reports/', { method: 'POST', body: JSON.stringify(body) })
  return res.data.attributes.results.map((r) => ({
    flowMessageId: r.groupings.flow_message_id ?? r.groupings['flow_message_id'],
    stats: r.statistics,
  }))
}

function pct(num: number, denom: number) {
  if (!denom) return '0.0 %'
  return `${((num / denom) * 100).toFixed(1)} %`
}

function eur(x: number | undefined) {
  if (typeof x !== 'number' || Number.isNaN(x)) return '—'
  return `${x.toFixed(2).replace(/\.00$/, '')} €`
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

async function main() {
  const timeframeKey = process.argv[2] ?? 'last_365_days'
  const timeframeLabel: Record<string, string> = {
    last_7_days: '7 derniers jours',
    last_30_days: '30 derniers jours',
    last_60_days: '60 derniers jours',
    last_90_days: '90 derniers jours',
    last_365_days: '365 derniers jours',
    last_12_months: '12 derniers mois',
  }
  const label = timeframeLabel[timeframeKey] ?? timeframeKey
  console.log(`=== Klaviyo abandon performance (${label}) ===\n`)
  const conversionMetricId = await findPlacedOrderMetricId()
  console.log(`Placed Order metric id: ${conversionMetricId}`)

  // Messages per flow + fetch flow creation dates so readers know the window.
  const flowMessages = new Map<string, Awaited<ReturnType<typeof listFlowEmailMessages>>>()
  const flowCreatedAt = new Map<string, string>()
  for (const f of TARGET_FLOWS) {
    const msgs = await listFlowEmailMessages(f.id)
    flowMessages.set(f.id, msgs)
    try {
      const flowRes = await klaviyo<{ data: { attributes: { created?: string; status?: string } } }>(
        `/api/flows/${f.id}/`,
      )
      flowCreatedAt.set(f.id, flowRes.data.attributes.created?.slice(0, 10) ?? '?')
    } catch {
      flowCreatedAt.set(f.id, '?')
    }
    console.log(`${f.id} "${f.name}" → ${msgs.length} email message(s), created ${flowCreatedAt.get(f.id)}`)
  }

  // One aggregate report, broken down by flow_message_id, for all target flows
  const reports = await pullFlowValuesReport(
    TARGET_FLOWS.map((f) => f.id),
    conversionMetricId,
    timeframeKey,
  )
  const reportByMsg = new Map(reports.map((r) => [r.flowMessageId, r.stats]))
  console.log(`\n${reports.length} flow_message_id rows in report\n`)

  // Build MD
  const lines: string[] = []
  lines.push(`# Klaviyo — analyse des flows d'abandon (${label})`)
  lines.push('')
  lines.push(
    `*Source : Klaviyo Reports API (\`flow-values-reports\`), timeframe \`${timeframeKey}\`. Générée le ${today()} via \`scripts/klaviyo-abandon-perf.ts\`.*`,
  )
  lines.push('')

  lines.push("## Vue d'ensemble des flows actifs")
  lines.push('')
  lines.push(
    'On a 6 flows dits "d\'abandon" en statut `live` dans Klaviyo, couvrant 3 étapes du funnel (browse → cart → checkout) × 2 langues (FR/EN), plus un flow winback.',
  )
  lines.push('')
  lines.push('| Flow | Lang | Étape | Statut | Créé | # emails |')
  lines.push('|---|:---:|---|---|---|---:|')
  for (const f of TARGET_FLOWS) {
    const msgs = flowMessages.get(f.id) ?? []
    const nameEscaped = f.name.replace(/\|/g, '\\|')
    lines.push(
      `| ${nameEscaped} | ${f.lang} | ${f.kind} | ${f.note ?? '?'} | ${flowCreatedAt.get(f.id) ?? '?'} | ${msgs.length} |`,
    )
  }
  lines.push('')
  lines.push(
    "> ⚠️ **Constat structurel immédiat** : il n'y a **pas de flow Checkout Abandonné FR en live** (`040 Bis | Checkout Abandonné SHOPI | B2C FR` est en status `draft`). Donc tous les prospects FR qui abandonnent au checkout ne reçoivent pas d'email de rattrapage — ils tombent uniquement dans le flow \"Panier Abandonné\" qui ne cible pas spécifiquement l'intention de commander.",
  )
  lines.push('')

  for (const f of TARGET_FLOWS) {
    const msgs = flowMessages.get(f.id) ?? []
    if (msgs.length === 0) continue
    const nameEscaped = f.name.replace(/\|/g, '\\|')
    lines.push(`## ${nameEscaped} (${f.lang} · ${f.kind} · ${f.note ?? '?'} · créé ${flowCreatedAt.get(f.id)})`)
    lines.push('')
    lines.push(
      '| Step | Nom interne | Subject | Destinataires | Délivré | Open rate | Click rate | Conversions | Revenu |',
    )
    lines.push('|---:|---|---|---:|---:|---:|---:|---:|---:|')
    let totalRecipients = 0
    let totalConversions = 0
    let totalRevenue = 0
    const perStep: {
      step: number
      recipients: number
      conversions: number
      revenue: number
      opens: number
      clicks: number
    }[] = []
    for (const m of msgs) {
      const s = reportByMsg.get(m.messageId) ?? {}
      const recipients = s.recipients ?? 0
      const delivered = s.delivered ?? 0
      const opens = s.opens_unique ?? 0
      const clicks = s.clicks_unique ?? 0
      const conv = s.conversion_uniques ?? s.conversions ?? 0
      const revenue = s.conversion_value ?? 0
      perStep.push({ step: m.step, recipients, conversions: conv, revenue, opens, clicks })
      totalRecipients += recipients
      totalConversions += conv
      totalRevenue += revenue
      lines.push(
        `| ${m.step} | \`${m.name.slice(0, 60)}\` | "${m.subject.slice(0, 60)}" | ${recipients} | ${delivered} | ${pct(opens, delivered)} | ${pct(clicks, delivered)} | ${conv} | ${eur(revenue)} |`,
      )
    }
    lines.push('')
    if (msgs.length >= 2 && totalConversions > 0) {
      lines.push('**Attribution dans la séquence** — de qui vient le recovery ?')
      lines.push('')
      for (const ps of perStep) {
        const share = totalConversions > 0 ? (ps.conversions / totalConversions) * 100 : 0
        lines.push(
          `- Email ${ps.step} : **${ps.conversions}** commandes attribuées = **${share.toFixed(1)} %** du recovery total du flow, ${eur(ps.revenue)} de revenu.`,
        )
      }
      lines.push('')
      lines.push(
        `Total flow : **${totalConversions}** commandes attribuées, ${eur(totalRevenue)} de revenu cumulé (fenêtre d'attribution Klaviyo par défaut = 5 jours après le click).`,
      )
      lines.push('')
    }

    // Drop-off from step N to N+1 — useful to see how many are still "in the flow"
    if (msgs.length >= 2) {
      lines.push("**Déperdition entre les étapes** — combien reçoivent l'email suivant ?")
      lines.push('')
      lines.push('| Étape | Destinataires | Δ vs étape précédente | % de la cohorte initiale |')
      lines.push('|---:|---:|---:|---:|')
      const base = perStep[0]?.recipients ?? 0
      let prev = base
      for (const ps of perStep) {
        const delta = prev - ps.recipients
        lines.push(
          `| Email ${ps.step} | ${ps.recipients} | ${ps === perStep[0] ? '—' : `−${delta} (${pct(delta, prev)})`} | ${pct(ps.recipients, base)} |`,
        )
        prev = ps.recipients
      }
      lines.push('')
      lines.push(
        "> Ce qui sort d'un flow entre 2 emails = personnes qui ont converti (skip automatique par Klaviyo) ou qui sont tombées dans un *exit trigger* (re-add to cart, etc.). La baisse N→N+1 est donc en partie *saine* (= conversions).",
      )
      lines.push('')
    }
  }

  lines.push('## Synthèse inter-flows')
  lines.push('')
  const flowTotals: { flow: (typeof TARGET_FLOWS)[number]; recipients: number; conv: number; revenue: number }[] = []
  for (const f of TARGET_FLOWS) {
    const msgs = flowMessages.get(f.id) ?? []
    let r = 0
    let c = 0
    let rev = 0
    for (const m of msgs) {
      const s = reportByMsg.get(m.messageId) ?? {}
      r += s.recipients ?? 0
      c += s.conversion_uniques ?? s.conversions ?? 0
      rev += s.conversion_value ?? 0
    }
    flowTotals.push({ flow: f, recipients: r, conv: c, revenue: rev })
  }
  lines.push('| Flow | Destinataires cumulés | Conversions | Taux de recovery | Revenu |')
  lines.push('|---|---:|---:|---:|---:|')
  for (const t of flowTotals) {
    const nameEscaped = t.flow.name.replace(/\|/g, '\\|')
    lines.push(`| ${nameEscaped} | ${t.recipients} | ${t.conv} | ${pct(t.conv, t.recipients)} | ${eur(t.revenue)} |`)
  }
  lines.push('')
  lines.push(
    '> Le "taux de recovery" ci-dessus = conversions / destinataires cumulés sur le flow entier, **toutes étapes confondues**. C\'est une borne basse utile pour comparer les flows entre eux, mais ce n\'est pas le taux par email (qui est dans chaque tableau ci-dessus).',
  )
  lines.push('')

  lines.push('## Lecture — à quoi sert chaque email ?')
  lines.push('')
  lines.push(
    '**Lis la ligne "Attribution dans la séquence" de chaque flow ci-dessus — c\'est la réponse directe à "est-ce que l\'email 2 et 3 servent à quelque chose ?" pour ce flow.**',
  )
  lines.push('')
  lines.push('Pattern type cité dans les benchmarks Klaviyo e-commerce, pour référence :')
  lines.push('')
  lines.push("- **Email 1** (envoyé ~1-4 h après l'abandon) : ~60-70 % du recovery.")
  lines.push('- **Email 2** (J+1, souvent avec discount) : ~20-30 %.')
  lines.push('- **Email 3** (J+3 à J+7, "dernière chance") : ~5-15 %.')
  lines.push('')
  lines.push("Si un flow s'écarte fortement du pattern, c'est un signal :")
  lines.push('')
  lines.push(
    "- **Email 1 à 100 %, les autres à 0 %** → soit les autres emails ne proposent rien de neuf (pas de discount, pas d'urgence), soit l'attribution \"5 jours après click\" les étouffe (un client qui clique email 1 + achète J+4 reste attribué à email 1 même s'il avait reçu email 2 entre-temps).",
  )
  lines.push(
    '- **Email 2 ou 3 domine** → pertinent (souvent = c\'est là que le discount est mis, ou le ton de "dernière chance" qui débloque).',
  )
  lines.push(
    "- **Email 1 solide, 2/3 à 0** avec petit sample → peut être un biais de fraîcheur (flow récemment activé, les gens n'ont pas encore dépassé le time-delay).",
  )
  lines.push('')

  lines.push('## Méthodologie / limites')
  lines.push('')
  lines.push(
    "- **Fenêtre d'attribution Shopify-Klaviyo** : par défaut une commande est attribuée au dernier email ouvert/cliqué dans les 5 jours précédents. Ce biais favorise systématiquement les premiers emails envoyés dans un flow.",
  )
  lines.push(
    '- **Skip if converted** : dès qu\'un destinataire convertit, Klaviyo le retire du flow. Donc les dénominateurs des emails 2 et 3 sont mécaniquement plus petits (et ne contiennent que les non-convertis des étapes précédentes). Ça rend la comparaison "par email" honnête, mais ça empêche de comparer "qui convertit le plus en absolu".',
  )
  lines.push(
    "- **Fraîcheur des flows** : un flow activé récemment n'a pas eu le temps d'exécuter ses time-delays (souvent J+1, J+3). Les emails 2 et 3 apparaissent alors à 0 destinataires alors qu'ils vont partir. Cf. date \"Créé\" de chaque flow dans la vue d'ensemble.",
  )
  lines.push(
    "- **Flow version** : on inclut `04 | Panier Abandonné - old` (draft) pour voir l'historique pré-refonte. Les chiffres des emails y sont ceux qu'ils ont produits quand ils étaient live, avant que le flow soit mis en draft.",
  )
  lines.push(
    "- **Ordre des emails** : basé sur l'ordre retourné par l'API. Pour les flows avec branches (`AB_TEST`, `BOOLEAN_BRANCH`, `UPDATE_CUSTOMER`), cet ordre peut ne pas refléter l'enchaînement temporel — vérifier dans l'UI Klaviyo si les chiffres étonnent (ex. email 3 avec plus de destinataires qu'email 2).",
  )
  lines.push('')

  const outPath = resolve(here, '..', 'docs', `klaviyo-abandon-perf-${today()}-${timeframeKey}.md`)
  writeFileSync(outPath, lines.join('\n'))
  console.log(`✓ Written: ${outPath}`)
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
