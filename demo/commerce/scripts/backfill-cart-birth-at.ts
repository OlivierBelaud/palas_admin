// One-shot backfill — populate `carts.cart_birth_at` from PostHog event
// history. For every cart_token observed in PostHog, set `cart_birth_at`
// to MIN(timestamp) of all cart:* / checkout:* events for that token.
//
// Why: `cart_birth_at` is a new column (introduced for visitor-session
// attribution). Existing rows have it NULL. A direct HogQL aggregation
// recovers the exact moment each cart was first seen — distinct from
// `created_at` (which reflects the moment the local row was written and
// gets re-stamped by `rebuild-carts`).
//
// Direct postgres on purpose — same rationale as
// `backfill-checkout-events.ts` (Manta `defineCommand` short-circuits
// at 300ms via Promise.race; from a one-shot CLI script we want the
// full pipeline awaited inline).
//
// Idempotence:
//   - UPDATE has `AND cart_birth_at IS NULL` so re-runs no-op on rows
//     already filled. Safe to re-run.
//   - Dry-run prints the per-token plan without writing.
//
// Run with:
//   pnpm exec tsx scripts/backfill-cart-birth-at.ts            # local DB
//   pnpm exec tsx scripts/backfill-cart-birth-at.ts --prod     # Neon prod
//   pnpm exec tsx scripts/backfill-cart-birth-at.ts --prod --dry-run

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const here = dirname(fileURLToPath(import.meta.url))

function loadEnv(rel: string, override: boolean): void {
  const full = resolve(here, '..', rel)
  try {
    const raw = readFileSync(full, 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (override || !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch {
    // ignore
  }
}

const useProd = process.argv.includes('--prod')
const dryRun = process.argv.includes('--dry-run')
loadEnv('.env', false)
if (useProd) loadEnv('.env.production', true)

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL missing')
  process.exit(1)
}
const PH_HOST = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
const PH_KEY = process.env.POSTHOG_PERSONAL_API_KEY ?? process.env.POSTHOG_API_KEY
if (!PH_KEY) {
  console.error('[backfill-cart-birth-at] missing POSTHOG_PERSONAL_API_KEY / POSTHOG_API_KEY env')
  process.exit(1)
}

const needsSsl = useProd || /neon\.tech/.test(DATABASE_URL)
const sql = postgres(DATABASE_URL, { ssl: needsSsl ? 'require' : undefined, max: 4, prepare: false })

async function hogql(query: string): Promise<unknown[][]> {
  const res = await fetch(`${PH_HOST}/api/projects/@current/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PH_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  })
  if (!res.ok) throw new Error(`HogQL ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { results?: unknown[][] }
  return data.results ?? []
}

interface BirthRow {
  cart_token: string
  first_seen: string
}

function decodeRow(row: unknown[]): BirthRow | null {
  const [token, firstSeen] = row
  if (typeof token !== 'string' || token.length === 0) return null
  if (typeof firstSeen !== 'string' || firstSeen.length === 0) return null
  return { cart_token: token, first_seen: firstSeen }
}

try {
  console.log(`[backfill-cart-birth-at] target: ${useProd ? 'PROD' : 'LOCAL'}  dryRun: ${dryRun}`)
  const t0 = Date.now()

  // Single aggregate query — group by cart_token and take MIN(timestamp).
  // Both `cart:%` and `checkout:%` are considered: the earliest signal we
  // ever heard about this cart is the birth moment, regardless of the
  // specific event class.
  console.log(`[backfill-cart-birth-at] running HogQL aggregation …`)
  const raws = await hogql(`
    SELECT properties.cart.token AS cart_token, MIN(timestamp) AS first_seen
      FROM events
     WHERE (event LIKE 'cart:%' OR event LIKE 'checkout:%')
       AND properties.cart.token IS NOT NULL
     GROUP BY 1
  `)
  console.log(`[backfill-cart-birth-at] HogQL returned ${raws.length} cart_token rows`)

  let totalUpdated = 0
  let totalAlreadySet = 0
  let totalMissingCart = 0
  let totalDropped = 0

  for (const raw of raws) {
    const decoded = decodeRow(raw)
    if (!decoded) {
      totalDropped += 1
      continue
    }

    if (dryRun) {
      console.log(`  [dry-run] ${decoded.cart_token}  → ${decoded.first_seen}`)
      continue
    }

    const rows = (await sql.unsafe(
      `UPDATE carts SET cart_birth_at = $1 WHERE cart_token = $2 AND cart_birth_at IS NULL RETURNING id`,
      [decoded.first_seen, decoded.cart_token],
    )) as Array<{ id: string }>

    if (rows.length > 0) {
      totalUpdated += 1
    } else {
      // Either the cart doesn't exist locally (PostHog has events for a
      // cart we never persisted — common with bot traffic / signal-free
      // first events) OR `cart_birth_at` is already set (idempotent
      // re-run). We can't tell the two apart from the RETURNING result
      // alone, so we do one cheap follow-up SELECT.
      const probe = (await sql.unsafe(`SELECT cart_birth_at FROM carts WHERE cart_token = $1 LIMIT 1`, [
        decoded.cart_token,
      ])) as Array<{ cart_birth_at: Date | null }>
      if (probe.length === 0) totalMissingCart += 1
      else totalAlreadySet += 1
    }

    if ((totalUpdated + totalAlreadySet + totalMissingCart) % 500 === 0) {
      console.log(
        `  progress: updated=${totalUpdated} alreadySet=${totalAlreadySet} missingCart=${totalMissingCart} dropped=${totalDropped}`,
      )
    }
  }

  console.log(`\n=== DONE in ${Math.round((Date.now() - t0) / 1000)}s ===`)
  console.log(`scanned cart_tokens:    ${raws.length}`)
  console.log(`updated:                ${totalUpdated}`)
  console.log(`already set (no-op):    ${totalAlreadySet}`)
  console.log(`missing local cart:     ${totalMissingCart}`)
  console.log(`dropped (bad row):      ${totalDropped}`)
  if (dryRun) {
    console.log(`\n(dry-run — no rows written)`)
  }
} catch (err) {
  console.error('FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
