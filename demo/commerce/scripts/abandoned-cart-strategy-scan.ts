// Read-only scan: count abandoned carts cross-tabulated with Klaviyo flow status.
// Strategy buckets:
//   A. Carts < 7d (post Mother's Day promo start):
//      A1. With Klaviyo abandonment email in last 5d → skip (Klaviyo flow still running)
//      A2. Without recent Klaviyo email → our relance
//   B. Carts 7d–30d (pre-promo): everyone, regardless of past Klaviyo flow.
// Run: tsx demo/commerce/scripts/abandoned-cart-strategy-scan.ts [prod|local]

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const target = (process.argv[2] ?? 'prod').toLowerCase()
const envFile = target === 'local' ? '.env' : '.env.production'

const here = dirname(fileURLToPath(import.meta.url))
const envLines = readFileSync(resolve(here, '..', envFile), 'utf8').split('\n')
for (const line of envLines) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const ssl = target === 'prod' ? ('require' as const) : false
const sql = postgres(process.env.DATABASE_URL!, { ssl, max: 1, prepare: false })

function pad(s: string | number, n: number) {
  return String(s).padEnd(n)
}

try {
  console.log(`=== ${target.toUpperCase()} — Abandoned-cart strategy scan v2 ===\n`)

  // Sanity: the klaviyo_events mirror table
  const [keTotal] = await sql<{ n: number; mn: Date | null; mx: Date | null }[]>`
    SELECT COUNT(*)::int AS n, MIN(occurred_at) AS mn, MAX(occurred_at) AS mx FROM klaviyo_events`
  console.log(`klaviyo_events rows: ${keTotal.n} — span ${keTotal.mn} → ${keTotal.mx}`)

  const metrics = await sql<{ metric: string; n: number }[]>`
    SELECT metric, COUNT(*)::int AS n FROM klaviyo_events
    WHERE occurred_at >= NOW() - INTERVAL '30 days'
    GROUP BY metric ORDER BY n DESC`
  console.log('klaviyo_events metrics (last 30d):')
  for (const r of metrics) console.log(`  ${pad(r.metric, 35)} ${r.n}`)
  console.log()

  // Headline: identified, not-completed
  const [tot] = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM carts
    WHERE email IS NOT NULL
      AND highest_stage <> 'completed'
      AND status <> 'completed'`
  console.log(`Identified + not-completed: ${tot.n}\n`)

  // The Strategy Cross-tab.
  // For each cart (identified, not-completed, last_action_at within 30d, idle > 2h),
  // determine:
  //   - bucket: <7d  vs  7d–30d
  //   - klaviyo_recent: any klaviyo_events with abandonment metric in last 5 days
  //                     (joining on lower(email))
  //   - manta_notified: abandon_notified_at IS NOT NULL
  const rows = await sql<
    {
      bucket: string
      klaviyo_recent: boolean
      manta_notified: boolean
      n: number
    }[]
  >`
    WITH eligible AS (
      SELECT
        c.id,
        c.email,
        c.last_action_at,
        c.abandon_notified_at,
        CASE WHEN c.last_action_at >= NOW() - INTERVAL '7 days' THEN 'A:<7d' ELSE 'B:7d–30d' END AS bucket
      FROM carts c
      WHERE c.email IS NOT NULL
        AND c.highest_stage <> 'completed'
        AND c.status <> 'completed'
        AND c.last_action_at >= NOW() - INTERVAL '30 days'
        AND c.last_action_at <  NOW() - INTERVAL '2 hours'
    ),
    klaviyo_recent_emails AS (
      SELECT DISTINCT lower(email) AS email
      FROM klaviyo_events
      WHERE occurred_at >= NOW() - INTERVAL '5 days'
        AND (
          metric = 'Shopify_Checkout_Abandonned'
          OR metric = 'Checkout Abandoned'
          OR (metric = 'Received Email' AND (
            subject ILIKE '%oublié quelque chose%'
            OR subject ILIKE '%pensez encore%'
            OR subject ILIKE '%attend plus que vous%'
          ))
        )
    )
    SELECT
      e.bucket,
      (k.email IS NOT NULL) AS klaviyo_recent,
      (e.abandon_notified_at IS NOT NULL) AS manta_notified,
      COUNT(*)::int AS n
    FROM eligible e
    LEFT JOIN klaviyo_recent_emails k ON k.email = lower(e.email)
    GROUP BY e.bucket, klaviyo_recent, manta_notified
    ORDER BY e.bucket, klaviyo_recent, manta_notified`
  console.log('Cross-tab (eligible window 2h–30d):')
  console.log('  bucket       klaviyo<5d  manta_notified  n')
  for (const r of rows) {
    console.log(
      `  ${pad(r.bucket, 12)} ${pad(r.klaviyo_recent ? 'YES' : 'no', 11)} ${pad(r.manta_notified ? 'YES' : 'no', 15)} ${r.n}`,
    )
  }
  console.log()

  // Strategy decision sums
  const sumA1 = rows.filter((r) => r.bucket === 'A:<7d' && r.klaviyo_recent).reduce((a, b) => a + b.n, 0)
  const sumA2 = rows.filter((r) => r.bucket === 'A:<7d' && !r.klaviyo_recent).reduce((a, b) => a + b.n, 0)
  const sumB = rows.filter((r) => r.bucket === 'B:7d–30d').reduce((a, b) => a + b.n, 0)
  const sumBwithKlaviyo = rows.filter((r) => r.bucket === 'B:7d–30d' && r.klaviyo_recent).reduce((a, b) => a + b.n, 0)

  console.log('Strategy:')
  console.log(`  A1. <7d  + Klaviyo<5d         → SKIP (let Klaviyo flow finish)   n=${sumA1}`)
  console.log(`  A2. <7d  + no Klaviyo<5d      → SEND (recovery email)            n=${sumA2}`)
  console.log(`  B.  7d–30d (everyone)         → SEND (mention -15% Mother's Day) n=${sumB}`)
  console.log(`      └─ of which had Klaviyo<5d (informational): ${sumBwithKlaviyo}`)
  console.log(`  TOTAL backfill volume: ${sumA2 + sumB}`)
  console.log()

  // Today snapshot — see if Klaviyo flow is firing now
  const [today] = await sql<{ n: number; klaviyo: number }[]>`
    SELECT
      COUNT(*)::int AS n,
      SUM(CASE WHEN k.email IS NOT NULL THEN 1 ELSE 0 END)::int AS klaviyo
    FROM carts c
    LEFT JOIN (
      SELECT DISTINCT lower(email) AS email FROM klaviyo_events
      WHERE occurred_at >= NOW() - INTERVAL '5 days'
        AND (metric = 'Shopify_Checkout_Abandonned' OR metric = 'Checkout Abandoned'
             OR (metric = 'Received Email' AND subject ILIKE '%oublié%'))
    ) k ON k.email = lower(c.email)
    WHERE c.email IS NOT NULL
      AND c.highest_stage <> 'completed'
      AND c.status <> 'completed'
      AND c.last_action_at::date = CURRENT_DATE`
  console.log(
    `Today's identified abandoned carts: ${today.n} — of which ${today.klaviyo} have a Klaviyo abandonment email in the last 5d`,
  )

  // Last 24h Klaviyo abandonment events — how active is the native flow?
  const [last24] = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM klaviyo_events
    WHERE occurred_at >= NOW() - INTERVAL '24 hours'
      AND (metric = 'Shopify_Checkout_Abandonned' OR metric = 'Checkout Abandoned'
           OR (metric = 'Received Email' AND subject ILIKE '%oublié%'))`
  console.log(`Klaviyo abandonment-flow events in last 24h: ${last24.n}`)
} finally {
  await sql.end({ timeout: 1 })
}
