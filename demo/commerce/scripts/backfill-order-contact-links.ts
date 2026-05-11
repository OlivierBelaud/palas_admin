// Backfill order_contact pivot — for every Order with email, link to the
// matching Contact (case-insensitive email). Mirror of backfill-cart-contact-links.
//
// Run with: pnpm tsx scripts/backfill-order-contact-links.ts --prod [--dry-run]

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const here = dirname(fileURLToPath(import.meta.url))

function loadEnv(rel: string, override: boolean): void {
  try {
    const raw = readFileSync(resolve(here, '..', rel), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (override || !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch {}
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

const needsSsl = useProd || /neon\.tech/.test(DATABASE_URL)
const sql = postgres(DATABASE_URL, { ssl: needsSsl ? 'require' : undefined, max: 4, prepare: false })

try {
  console.log(`[backfill-order-contact-links] target: ${useProd ? 'PROD' : 'LOCAL'}  dryRun: ${dryRun}`)
  const t0 = Date.now()

  const orphans = (await sql`
    SELECT o.id::text AS order_id, LOWER(o.email) AS email
      FROM orders o
     WHERE o.email IS NOT NULL
       AND o.email <> ''
       AND NOT EXISTS (SELECT 1 FROM order_contact oc WHERE oc.order_id = o.id::text)
  `) as Array<{ order_id: string; email: string }>

  console.log(`[backfill-order-contact-links] orphan orders: ${orphans.length}`)

  let linked = 0
  let no_contact = 0
  let errors = 0

  for (const o of orphans) {
    try {
      const c = (await sql`SELECT id::text AS id FROM contacts WHERE LOWER(email) = ${o.email} LIMIT 1`) as Array<{
        id: string
      }>
      if (!c[0]) {
        no_contact++
        continue
      }
      if (!dryRun) {
        await sql`
          INSERT INTO order_contact (id, order_id, contact_id, created_at, updated_at)
          VALUES (gen_random_uuid(), ${o.order_id}, ${c[0].id}, NOW(), NOW())
          ON CONFLICT DO NOTHING`
      }
      linked++
    } catch (err) {
      errors++
      if (errors <= 10) console.warn(`  ${o.order_id}: ${(err as Error).message}`)
    }
  }

  console.log(`\n=== DONE in ${Math.round((Date.now() - t0) / 1000)}s ===`)
  console.log(`  orphans:    ${orphans.length}`)
  console.log(`  linked:     ${linked}`)
  console.log(`  no_contact: ${no_contact}`)
  console.log(`  errors:     ${errors}`)
  if (dryRun) console.log(`(dry-run)`)
} catch (err) {
  console.error('FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
