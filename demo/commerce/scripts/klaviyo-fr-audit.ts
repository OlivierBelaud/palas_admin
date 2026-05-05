// FULL audit of every flow in Klaviyo that could possibly be a
// cart/checkout abandonment flow (FR + EN, live + draft + archived + manual).
// For each: name, status, archived, trigger, created date, actions, and
// 365-day performance. Also dumps the FR-specific summary for the user.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const envLines = readFileSync(resolve(here, '..', '.env'), 'utf8').split('\n')
for (const line of envLines) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const KEY = process.env.KLAVIYO_API_KEY!
const HOST = 'https://a.klaviyo.com'
const REVISION = '2024-10-15'

async function klaviyo<T = unknown>(path: string, init?: RequestInit, attempt = 1): Promise<T> {
  const res = await fetch(`${HOST}${path}`, {
    ...init,
    headers: {
      Authorization: `Klaviyo-API-Key ${KEY}`,
      accept: 'application/json',
      'content-type': 'application/json',
      revision: REVISION,
      ...(init?.headers ?? {}),
    },
  })
  if (res.status === 429 && attempt <= 5) {
    const wait = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200)
    await new Promise((r) => setTimeout(r, wait))
    return klaviyo<T>(path, init, attempt + 1)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Klaviyo ${path} → ${res.status} ${body.slice(0, 400)}`)
  }
  if (res.status === 204) return {} as T
  return (await res.json()) as T
}

interface FlowSummary {
  id: string
  name: string
  status: string
  archived: boolean
  trigger_type: string | null
  created: string | null
  updated: string | null
  // filled later
  actions?: {
    id: string
    action_type: string
    status: string
    messageId?: string
    subject?: string
    name?: string
  }[]
  perf?: Record<string, Record<string, number>>
}

function isAbandonCandidate(name: string) {
  return /abandon|panier|cart|checkout/i.test(name)
}

type FlowsListPage = {
  data: {
    id: string
    attributes: {
      name: string
      status: string
      archived: boolean
      trigger_type?: string | null
      created?: string
      updated?: string
    }
  }[]
  links?: { next?: string | null }
}

async function listAllFlows(): Promise<FlowSummary[]> {
  const out: FlowSummary[] = []
  let url: string | null = '/api/flows/'
  while (url) {
    const res: FlowsListPage = await klaviyo<FlowsListPage>(url)
    for (const f of res.data) {
      out.push({
        id: f.id,
        name: f.attributes.name,
        status: f.attributes.status,
        archived: Boolean(f.attributes.archived),
        trigger_type: f.attributes.trigger_type ?? null,
        created: f.attributes.created?.slice(0, 10) ?? null,
        updated: f.attributes.updated?.slice(0, 10) ?? null,
      })
    }
    url = res.links?.next ? res.links.next.replace(HOST, '') : null
  }
  return out
}

async function attachActionsAndMessages(flow: FlowSummary) {
  try {
    const actionsRes = await klaviyo<{
      data: { id: string; attributes: { action_type: string; status?: string } }[]
    }>(`/api/flows/${flow.id}/flow-actions/`)
    flow.actions = []
    for (const a of actionsRes.data) {
      const entry = {
        id: a.id,
        action_type: a.attributes.action_type,
        status: a.attributes.status ?? '?',
      } as NonNullable<FlowSummary['actions']>[number]
      if (a.attributes.action_type === 'SEND_EMAIL') {
        try {
          const mRes = await klaviyo<{
            data: { id: string; attributes: { name?: string; content?: { subject?: string } } }[]
          }>(`/api/flow-actions/${a.id}/flow-messages/`)
          const m = mRes.data[0]
          if (m) {
            entry.messageId = m.id
            entry.name = m.attributes.name
            entry.subject = m.attributes.content?.subject
          }
        } catch {
          /* skip msg fetch failure */
        }
      }
      flow.actions!.push(entry)
    }
  } catch (err) {
    console.warn(`[${flow.id}] actions fetch failed: ${(err as Error).message.slice(0, 120)}`)
  }
}

type MetricsListPage = {
  data: { id: string; attributes: { name: string; integration?: { name?: string } } }[]
  links?: { next?: string | null }
}

async function findPlacedOrderMetricId(): Promise<string> {
  let url: string | null = '/api/metrics/'
  let firstMatch: string | null = null
  while (url) {
    const res: MetricsListPage = await klaviyo<MetricsListPage>(url)
    for (const m of res.data) {
      if (m.attributes.name !== 'Placed Order') continue
      if (m.attributes.integration?.name === 'Shopify') return m.id
      if (!firstMatch) firstMatch = m.id
    }
    url = res.links?.next ? res.links.next.replace(HOST, '') : null
  }
  if (firstMatch) return firstMatch
  throw new Error('Placed Order metric not found')
}

async function pullPerf(flowIds: string[], conversionMetricId: string) {
  // Klaviyo caps payloads; chunk flow ids to stay safe.
  const chunks: string[][] = []
  for (let i = 0; i < flowIds.length; i += 20) chunks.push(flowIds.slice(i, i + 20))
  const all = new Map<string, Record<string, number>>()
  for (const chunk of chunks) {
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
          ],
          timeframe: { key: 'last_365_days' },
          conversion_metric_id: conversionMetricId,
          filter: `contains-any(flow_id,[${chunk.map((id) => `"${id}"`).join(',')}])`,
          group_by: ['flow_id', 'flow_message_id'],
        },
      },
    }
    const res = await klaviyo<{
      data: {
        attributes: {
          results: {
            groupings: { flow_id: string; flow_message_id: string }
            statistics: Record<string, number>
          }[]
        }
      }
    }>('/api/flow-values-reports/', { method: 'POST', body: JSON.stringify(body) })
    for (const r of res.data.attributes.results) {
      all.set(r.groupings.flow_message_id, r.statistics)
    }
  }
  return all
}

function pct(n: number, d: number) {
  if (!d) return '—'
  return `${((n / d) * 100).toFixed(1)} %`
}

function eur(x: number | undefined) {
  if (typeof x !== 'number' || Number.isNaN(x)) return '—'
  return `${x.toFixed(2).replace(/\.00$/, '')} €`
}

async function main() {
  console.log('=== Klaviyo FR abandon full audit ===\n')
  const allFlows = await listAllFlows()
  console.log(`Total flows in account: ${allFlows.length}`)
  const candidates = allFlows.filter((f) => isAbandonCandidate(f.name))
  console.log(`Cart/checkout/abandon candidates: ${candidates.length}\n`)

  for (const f of candidates) {
    await attachActionsAndMessages(f)
  }

  const conversionMetricId = await findPlacedOrderMetricId()
  const perf = await pullPerf(
    candidates.map((c) => c.id),
    conversionMetricId,
  )

  // Markdown output
  const lines: string[] = []
  lines.push(`# Audit Klaviyo — flows d'abandon FR (365 derniers jours)`)
  lines.push('')
  lines.push(
    `*Généré le ${new Date().toISOString().slice(0, 10)}. Source : Klaviyo Reports API. Périmètre : tous les flows dont le nom contient "abandon", "panier", "cart" ou "checkout", tous statuts confondus (live + draft + manual + archived).*`,
  )
  lines.push('')

  lines.push("## Inventaire complet des flows d'abandon")
  lines.push('')
  lines.push('| Flow | Statut | Archivé | Trigger | Créé | MàJ | # emails | Destinataires 365j |')
  lines.push('|---|---|:---:|---|---|---|---:|---:|')
  for (const f of candidates) {
    const emails = f.actions?.filter((a) => a.action_type === 'SEND_EMAIL') ?? []
    let totalRecipients = 0
    for (const e of emails) {
      if (!e.messageId) continue
      const s = perf.get(e.messageId)
      if (s) totalRecipients += s.recipients ?? 0
    }
    const nameEscaped = f.name.replace(/\|/g, '\\|')
    lines.push(
      `| [${f.id}] ${nameEscaped} | ${f.status} | ${f.archived ? 'oui' : 'non'} | ${f.trigger_type ?? '?'} | ${f.created ?? '?'} | ${f.updated ?? '?'} | ${emails.length} | ${totalRecipients} |`,
    )
  }
  lines.push('')

  // FR section only
  lines.push('## Focus FR — chaque flow pouvant toucher le marché français')
  lines.push('')
  const frCandidates = candidates.filter(
    (c) => /FR|francais|français|panier/i.test(c.name) && !/B2B|Reseller|WS/i.test(c.name),
  )
  for (const f of frCandidates) {
    const nameEscaped = f.name.replace(/\|/g, '\\|')
    lines.push(`### [${f.id}] ${nameEscaped}`)
    lines.push('')
    lines.push(
      `- **Statut** : \`${f.status}\`${f.archived ? ' (ARCHIVÉ)' : ''} · **Trigger** : ${f.trigger_type ?? '?'} · **Créé** : ${f.created ?? '?'} · **Dernière MàJ** : ${f.updated ?? '?'}`,
    )
    lines.push('')

    // Action structure
    lines.push('**Structure du flow :**')
    lines.push('')
    if (!f.actions || f.actions.length === 0) {
      lines.push('  (aucune action récupérable)')
    } else {
      lines.push('| # | Action | Statut | Subject |')
      lines.push('|---:|---|---|---|')
      f.actions.forEach((a, i) => {
        lines.push(`| ${i + 1} | \`${a.action_type}\` | ${a.status} | ${a.subject ? `"${a.subject}"` : '—'} |`)
      })
    }
    lines.push('')

    // Perf per email
    const emails = f.actions?.filter((a) => a.action_type === 'SEND_EMAIL') ?? []
    if (emails.length > 0) {
      lines.push('**Performance 365 jours par email :**')
      lines.push('')
      lines.push('| # | Subject | Destinataires | Délivrés | Open | Click | Conversions | Revenu |')
      lines.push('|---:|---|---:|---:|---:|---:|---:|---:|')
      let totalRecipients = 0
      let totalConversions = 0
      let totalRevenue = 0
      for (let i = 0; i < emails.length; i++) {
        const e = emails[i]
        const s = (e.messageId ? perf.get(e.messageId) : undefined) ?? {}
        const r = s.recipients ?? 0
        const d = s.delivered ?? 0
        const o = s.opens_unique ?? 0
        const c = s.clicks_unique ?? 0
        const conv = s.conversion_uniques ?? s.conversions ?? 0
        const rev = s.conversion_value ?? 0
        totalRecipients += r
        totalConversions += conv
        totalRevenue += rev
        lines.push(
          `| ${i + 1} | ${e.subject ? `"${e.subject.slice(0, 55)}"` : '—'} | ${r} | ${d} | ${pct(o, d)} | ${pct(c, d)} | ${conv} | ${eur(rev)} |`,
        )
      }
      lines.push(
        `| **Total flow** | — | ${totalRecipients} | — | — | — | **${totalConversions}** | **${eur(totalRevenue)}** |`,
      )
      lines.push('')
    } else {
      lines.push('_(aucun email configuré dans ce flow)_')
      lines.push('')
    }
  }

  // ── Diagnostic bloc ─────────────────────────────────────────────
  lines.push('## Diagnostic')
  lines.push('')

  // For each FR candidate, state what's up
  const diagnostic: string[] = []
  for (const f of frCandidates) {
    const emails = f.actions?.filter((a) => a.action_type === 'SEND_EMAIL') ?? []
    let totalRecipients = 0
    let totalConv = 0
    for (const e of emails) {
      const s = e.messageId ? perf.get(e.messageId) : undefined
      if (s) {
        totalRecipients += s.recipients ?? 0
        totalConv += s.conversion_uniques ?? s.conversions ?? 0
      }
    }
    const nameClean = f.name.replace(/\|/g, '\\|')
    let status = ''
    if (f.archived) status = '🔴 ARCHIVÉ — ne tourne plus'
    else if (f.status === 'draft')
      status =
        totalRecipients > 0 ? '🟡 DRAFT mais a tourné historiquement' : "🟡 DRAFT — n'a jamais envoyé (ou pas en 365 j)"
    else if (f.status === 'live')
      status = totalRecipients > 0 ? '🟢 LIVE — tourne' : '🟠 LIVE mais 0 envoi en 365 j (trigger ne matche rien ?)'
    else status = `❔ ${f.status}`
    diagnostic.push(
      `- **[${f.id}] ${nameClean}** — ${status} · ${totalRecipients} destinataires cumulés, ${totalConv} conv.`,
    )
  }
  lines.push(diagnostic.join('\n'))
  lines.push('')

  const outPath = resolve(here, '..', 'docs', `klaviyo-fr-audit-${new Date().toISOString().slice(0, 10)}.md`)
  writeFileSync(outPath, lines.join('\n'))
  console.log(`\n✓ Audit écrit : ${outPath}`)

  // Also dump a compact CLI summary
  console.log('\n=== Résumé FR ===')
  for (const f of frCandidates) {
    const emails = f.actions?.filter((a) => a.action_type === 'SEND_EMAIL') ?? []
    let totalRecipients = 0
    let totalConv = 0
    for (const e of emails) {
      const s = e.messageId ? perf.get(e.messageId) : undefined
      if (s) {
        totalRecipients += s.recipients ?? 0
        totalConv += s.conversion_uniques ?? s.conversions ?? 0
      }
    }
    const nameClean = f.name.length > 55 ? `${f.name.slice(0, 55)}…` : f.name
    console.log(
      `  [${f.id}] ${nameClean.padEnd(58)} ${f.status.padEnd(7)} arch=${f.archived ? 'Y' : 'N'}  created=${f.created}  updated=${f.updated}  recipients365=${totalRecipients}  conv=${totalConv}`,
    )
  }
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
