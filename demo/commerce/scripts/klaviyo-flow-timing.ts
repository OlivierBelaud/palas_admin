// Pull the TIME_DELAY configuration of every action in the abandon flows
// and compute cumulative delay before each SEND_EMAIL — so we know exactly
// "email N part T heures après l'abandon".

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
    return klaviyo(path, init, attempt + 1)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Klaviyo ${path} → ${res.status} ${body.slice(0, 400)}`)
  }
  return (await res.json()) as T
}

const FLOWS = [
  { id: 'YuzaSN', name: 'FR Checkout Abandonné', status: 'live' },
  { id: 'SYA3es', name: 'FR Panier Abandonné (ancien, draft)', status: 'draft' },
  { id: 'W4ruD9', name: 'FR Panier Abandonné (nouveau, live)', status: 'live' },
  { id: 'Tj89Zg', name: 'FR Panier Abandonné - Typeform (draft)', status: 'draft' },
  { id: 'RrYMuk', name: 'FR Winback 2 months', status: 'live' },
  { id: 'WCcxfn', name: 'FR Navigation Abandonnée', status: 'live' },
  { id: 'WL5Bc6', name: 'EN Panier Abandonné', status: 'live' },
  { id: 'VGzPTF', name: 'EN Checkout Abandonné', status: 'live' },
]

interface ActionDetail {
  id: string
  action_type: string
  status?: string
  settings?: Record<string, unknown>
  send_options?: Record<string, unknown>
  tracking_options?: Record<string, unknown>
  // derived
  delaySeconds?: number
  messageId?: string
  subject?: string
}

async function fetchActionDetail(actionId: string): Promise<ActionDetail> {
  const res = await klaviyo<{
    data: {
      id: string
      attributes: {
        action_type: string
        status?: string
        settings?: Record<string, unknown>
        send_options?: Record<string, unknown>
        tracking_options?: Record<string, unknown>
      }
    }
  }>(`/api/flow-actions/${actionId}/`)
  const a = res.data
  return {
    id: a.id,
    action_type: a.attributes.action_type,
    status: a.attributes.status,
    settings: a.attributes.settings,
    send_options: a.attributes.send_options,
    tracking_options: a.attributes.tracking_options,
  }
}

// Klaviyo's actual shape: settings.delay_seconds (plus days_of_week to
// restrict which days the delay can expire on — the effective delay can
// stretch past delay_seconds if the target day falls outside the allowed
// set, but for our temporal reading we use the raw value).
function extractDelaySeconds(settings: Record<string, unknown> | undefined): number {
  if (!settings) return 0
  const n = Number(settings.delay_seconds ?? 0)
  return Number.isFinite(n) ? n : 0
}

function formatDuration(seconds: number): string {
  if (!seconds) return 'immédiat'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days) parts.push(`${days}j`)
  if (hours) parts.push(`${hours}h`)
  if (!days && minutes) parts.push(`${minutes}m`)
  return parts.length ? parts.join(' ') : `${seconds}s`
}

async function analyzeFlow(flowId: string, flowName: string) {
  const actionsRes = await klaviyo<{ data: { id: string; attributes: { action_type: string } }[] }>(
    `/api/flows/${flowId}/flow-actions/`,
  )
  const actionIds = actionsRes.data.map((a) => a.id)

  const details: ActionDetail[] = []
  for (const aid of actionIds) {
    const d = await fetchActionDetail(aid)
    if (d.action_type === 'TIME_DELAY') {
      d.delaySeconds = extractDelaySeconds(d.settings)
    }
    if (d.action_type === 'SEND_EMAIL') {
      try {
        const mRes = await klaviyo<{
          data: { id: string; attributes: { name?: string; content?: { subject?: string } } }[]
        }>(`/api/flow-actions/${d.id}/flow-messages/`)
        const m = mRes.data[0]
        if (m) {
          d.messageId = m.id
          d.subject = m.attributes.content?.subject
        }
      } catch {
        /* ignore */
      }
    }
    details.push(d)
  }

  // Walk the sequence, accumulating TIME_DELAY seconds to each SEND_EMAIL.
  // NB: for flows with branches (AB_TEST / BOOLEAN_BRANCH) this linear read
  // isn't 100% accurate — some emails may be reached via branches with
  // different cumulated delays. We'll print the structure too so you can
  // see the actual shape.
  let cumul = 0
  const emailTimings: {
    step: number
    cumulativeSec: number
    delayFromPrev: number
    subject?: string
    status?: string
  }[] = []
  let prevEmailCumul = 0
  let emailStep = 0
  for (const d of details) {
    if (d.action_type === 'TIME_DELAY') {
      cumul += d.delaySeconds ?? 0
    } else if (d.action_type === 'SEND_EMAIL') {
      emailStep++
      emailTimings.push({
        step: emailStep,
        cumulativeSec: cumul,
        delayFromPrev: cumul - prevEmailCumul,
        subject: d.subject,
        status: d.status,
      })
      prevEmailCumul = cumul
    }
  }

  return { flowId, flowName, details, emailTimings }
}

async function main() {
  const lines: string[] = []
  lines.push("# Temporalité des flows d'abandon")
  lines.push('')
  lines.push(
    `*Généré le ${new Date().toISOString().slice(0, 10)}. Source : Klaviyo \`/api/flow-actions/{id}/\` (champ \`settings\` des TIME_DELAY). Temps exprimés par rapport au moment du trigger (= moment où la personne a abandonné).*`,
  )
  lines.push('')

  for (const f of FLOWS) {
    console.log(`→ ${f.id} ${f.name}`)
    const a = await analyzeFlow(f.id, f.name)

    lines.push(`## ${f.name} (\`${f.id}\` · ${f.status})`)
    lines.push('')

    if (a.emailTimings.length === 0) {
      lines.push("_(pas d'email dans ce flow)_")
      lines.push('')
      continue
    }

    lines.push("| # email | Subject | Temps depuis le trigger | Délai depuis l'email précédent | Statut de l'action |")
    lines.push('|---:|---|---|---|---|')
    for (const e of a.emailTimings) {
      lines.push(
        `| ${e.step} | ${e.subject ? `"${e.subject.slice(0, 60)}"` : '—'} | **${formatDuration(e.cumulativeSec)}** | ${e.step === 1 ? '—' : formatDuration(e.delayFromPrev)} | ${e.status ?? '?'} |`,
      )
    }
    lines.push('')

    // Full structure dump — useful to see branches / AB tests
    lines.push('<details><summary>Structure complète du flow</summary>')
    lines.push('')
    lines.push('| # | Action | Détail |')
    lines.push('|---:|---|---|')
    a.details.forEach((d, i) => {
      let detail = `status=${d.status ?? '?'}`
      if (d.action_type === 'TIME_DELAY' && d.delaySeconds !== undefined) {
        detail += ` · delay=${formatDuration(d.delaySeconds)}`
      }
      if (d.action_type === 'SEND_EMAIL' && d.subject) {
        detail += ` · subject="${d.subject.slice(0, 55)}"`
      }
      lines.push(`| ${i + 1} | \`${d.action_type}\` | ${detail} |`)
    })
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }

  const outPath = resolve(here, '..', 'docs', `klaviyo-flow-timing-${new Date().toISOString().slice(0, 10)}.md`)
  writeFileSync(outPath, lines.join('\n'))
  console.log(`\n✓ Timing doc: ${outPath}`)

  // Console summary
  console.log('\n=== Résumé timing ===')
  // Re-walk each flow's emailTimings from the doc? Easier: re-run analyze
  // (cached via this closure — we actually already have the data but it's
  // not in scope here; rebuild quickly from FLOWS array)
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
