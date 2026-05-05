// Step 1 — reconnaissance. Map out all flows in Klaviyo, then drill into the
// ones that look like cart / checkout abandonment. Read-only. Prints the
// structure so we know what to pull for the performance report.

import { readFileSync } from 'node:fs'
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

const HOST = process.env.KLAVIYO_HOST ?? 'https://a.klaviyo.com'
const REVISION = '2024-10-15'

async function klaviyo<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${HOST}${path}`, {
    ...init,
    headers: {
      Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
      accept: 'application/json',
      revision: REVISION,
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    throw new Error(`Klaviyo ${path} → ${res.status} ${await res.text().catch(() => '')}`)
  }
  return (await res.json()) as T
}

interface FlowListItem {
  id: string
  attributes: {
    name: string
    status: string
    trigger_type?: string
    archived?: boolean
    created?: string
    updated?: string
  }
}

interface FlowAction {
  id: string
  attributes: {
    action_type: string
    status?: string
    tracking_options?: Record<string, unknown>
    send_options?: Record<string, unknown>
    settings?: Record<string, unknown>
  }
  relationships?: {
    'flow-message'?: { data: { id: string; type: string } | null }
  }
}

interface FlowMessage {
  id: string
  attributes: {
    name?: string
    channel?: string
    content?: {
      subject?: string
      preview_text?: string
      from_email?: string
      from_label?: string
    }
    send_times?: unknown
    created?: string
    updated?: string
  }
}

function isAbandonmentFlow(name: string, triggerType?: string) {
  const n = name.toLowerCase()
  const t = (triggerType ?? '').toLowerCase()
  return /abandon|cart|checkout|abandonn|panier/i.test(n) || /started\s*checkout|abandoned/i.test(t)
}

async function run() {
  console.log(`=== Klaviyo flows (${HOST}) ===\n`)
  const flowsRes = await klaviyo<{ data: FlowListItem[]; links?: { next?: string | null } }>(
    '/api/flows/?page[size]=50',
  )
  const flows = flowsRes.data
  console.log(`${flows.length} flows total\n`)

  const abandon = flows.filter((f) => isAbandonmentFlow(f.attributes.name, f.attributes.trigger_type))
  console.log(`Abandonment-like flows: ${abandon.length}`)
  for (const f of abandon) {
    console.log(
      `  [${f.id}] "${f.attributes.name}"  status=${f.attributes.status}  trigger=${f.attributes.trigger_type ?? '?'}  archived=${f.attributes.archived}`,
    )
  }

  console.log('\n=== All flows (name + status) ===')
  for (const f of flows) {
    console.log(
      `  [${f.id}] "${f.attributes.name}"  status=${f.attributes.status}  trigger=${f.attributes.trigger_type ?? '?'}`,
    )
  }

  // For each abandonment flow, list its actions (messages + delays)
  console.log('\n=== Flow drill-down ===')
  for (const f of abandon) {
    console.log(`\n── "${f.attributes.name}" (${f.id}) ──`)
    try {
      const actionsRes = await klaviyo<{ data: FlowAction[] }>(`/api/flows/${f.id}/flow-actions/?page[size]=50`)
      const actions = actionsRes.data
      console.log(`  ${actions.length} actions`)
      for (const a of actions) {
        const msgRel = a.relationships?.['flow-message']?.data
        const msgId = msgRel?.id
        let msgPreview = ''
        if (msgId) {
          try {
            const m = await klaviyo<{ data: FlowMessage }>(`/api/flow-messages/${msgId}/`)
            const c = m.data.attributes.content
            msgPreview = `  subject="${c?.subject ?? ''}"  from="${c?.from_label ?? ''}"  name="${m.data.attributes.name ?? ''}"`
          } catch (err) {
            msgPreview = `  (message fetch failed: ${(err as Error).message.slice(0, 60)})`
          }
        }
        console.log(`    ${a.attributes.action_type.padEnd(16)}  status=${a.attributes.status ?? '?'}${msgPreview}`)
      }
    } catch (err) {
      console.log(`  (flow-actions fetch failed: ${(err as Error).message.slice(0, 100)})`)
    }
  }
}

run().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
