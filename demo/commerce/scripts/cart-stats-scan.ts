// Inspect the carts table + identify all Olivier test sessions (by email
// OR by distinct_id transitively, since he opened multiple tabs without
// always entering an email). Read-only; writes a cart_tokens list to
// /tmp/olivier-carts.json for the cleanup step.

import { readFileSync, writeFileSync } from 'node:fs'
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

function fmtDate(d: Date | string) {
  return new Date(d).toISOString().slice(0, 10)
}

try {
  console.log(`=== ${target.toUpperCase()} DB ===\n`)

  const [total] = await sql`SELECT COUNT(*)::int AS n FROM carts`
  const [range] = await sql`SELECT MIN(last_action_at)::date AS first, MAX(last_action_at)::date AS last FROM carts`
  console.log(`Carts: ${total?.n} rows. Activity range: ${fmtDate(range?.first)} → ${fmtDate(range?.last)}\n`)

  const byDay = await sql<{ day: Date; n: number; total: string }[]>`
    SELECT last_action_at::date AS day, COUNT(*)::int AS n, SUM(total_price)::numeric(14,2) AS total
    FROM carts GROUP BY day ORDER BY day DESC`
  console.log('By day (last_action_at):')
  for (const row of byDay) console.log(`  ${fmtDate(row.day)}  n=${row.n}  total=${row.total} €`)

  // Step 1: direct email match
  const oliviers = await sql<{ id: string; cart_token: string; email: string | null; distinct_id: string | null }[]>`
    SELECT id, cart_token, email, distinct_id
    FROM carts
    WHERE LOWER(COALESCE(email,'')) LIKE '%belaud%'
       OR LOWER(COALESCE(email,'')) LIKE 'olivierbelaud%'
       OR LOWER(COALESCE(first_name,'')) = 'olivier'`
  console.log(`\nOlivier carts (direct email/name match): ${oliviers.length}`)
  for (const r of oliviers)
    console.log(`  id=${r.id}  token=${r.cart_token.slice(0, 20)}…  email=${r.email}  distinct_id=${r.distinct_id}`)

  const oliverDistinctIds = new Set(oliviers.map((c) => c.distinct_id).filter(Boolean))
  // Step 2: other carts sharing those distinct_ids (no email yet, but same browser)
  let transitive: { id: string; cart_token: string; email: string | null; distinct_id: string | null }[] = []
  if (oliverDistinctIds.size > 0) {
    const ids = Array.from(oliverDistinctIds)
    transitive = (await sql`
      SELECT id, cart_token, email, distinct_id
      FROM carts
      WHERE distinct_id = ANY(${ids}::text[])
        AND id <> ALL(${oliviers.map((c) => c.id)}::text[])
    `) as typeof transitive
  }
  console.log(`\nAdditional carts sharing Olivier distinct_ids: ${transitive.length}`)
  for (const r of transitive)
    console.log(`  id=${r.id}  token=${r.cart_token.slice(0, 20)}…  email=${r.email}  distinct_id=${r.distinct_id}`)

  const allIds = [...oliviers, ...transitive].map((c) => c.id)
  const allTokens = [...oliviers, ...transitive].map((c) => c.cart_token)
  writeFileSync(
    '/tmp/olivier-carts.json',
    JSON.stringify({ target, cart_ids: allIds, cart_tokens: allTokens, distinct_ids: [...oliverDistinctIds] }, null, 2),
  )
  console.log(`\n→ /tmp/olivier-carts.json (${allIds.length} cart ids + ${oliverDistinctIds.size} distinct_ids)`)
} finally {
  await sql.end()
}
