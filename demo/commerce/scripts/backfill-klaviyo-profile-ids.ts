// Backfill contacts.klaviyo_profile_id — for every Contact with no profile id,
// query Klaviyo /api/profiles?filter=equals(email,...) and set the id when
// matched. Best-effort: contacts not in Klaviyo stay null.
//
// Run: pnpm tsx scripts/backfill-klaviyo-profile-ids.ts --prod [--dry-run] [--limit N]

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
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : 100000
loadEnv('.env', false)
if (useProd) loadEnv('.env.production', true)

const DATABASE_URL = process.env.DATABASE_URL
const KLAVIYO_KEY = process.env.KLAVIYO_API_KEY
if (!DATABASE_URL || !KLAVIYO_KEY) {
  console.error('missing DATABASE_URL or KLAVIYO_API_KEY')
  process.exit(1)
}

const needsSsl = useProd || /neon\.tech/.test(DATABASE_URL)
const sql = postgres(DATABASE_URL, { ssl: needsSsl ? 'require' : undefined, max: 4, prepare: false })

async function findKlaviyoProfileId(email: string): Promise<string | null> {
  const url = `https://a.klaviyo.com/api/profiles?filter=equals(email,"${encodeURIComponent(email)}")&fields[profile]=email`
  const res = await fetch(url, {
    headers: {
      Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
      revision: '2024-10-15',
      accept: 'application/json',
    },
  })
  if (!res.ok) {
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') ?? '5')
      await new Promise((r) => setTimeout(r, (retry + 1) * 1000))
      return findKlaviyoProfileId(email)
    }
    return null
  }
  const body = (await res.json()) as { data?: Array<{ id: string }> }
  return body.data?.[0]?.id ?? null
}

try {
  console.log(
    `[backfill-klaviyo-profile-ids] target: ${useProd ? 'PROD' : 'LOCAL'}  dryRun: ${dryRun}  limit: ${LIMIT}`,
  )
  const t0 = Date.now()

  const contacts = (await sql`
    SELECT id::text AS id, email FROM contacts
     WHERE klaviyo_profile_id IS NULL
       AND email IS NOT NULL
     ORDER BY last_activity_at DESC NULLS LAST
     LIMIT ${LIMIT}`) as Array<{ id: string; email: string }>

  console.log(`[backfill-klaviyo-profile-ids] contacts to probe: ${contacts.length}`)

  let resolved = 0
  let missing = 0
  let errors = 0

  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i]
    try {
      const pid = await findKlaviyoProfileId(c.email.toLowerCase())
      if (pid) {
        if (!dryRun) {
          await sql`UPDATE contacts SET klaviyo_profile_id = ${pid}, klaviyo_synced_at = NOW() WHERE id::text = ${c.id} AND klaviyo_profile_id IS NULL`
        }
        resolved++
      } else {
        missing++
      }
      if ((i + 1) % 50 === 0) {
        console.log(`  progress=${i + 1}/${contacts.length} resolved=${resolved} missing=${missing} errors=${errors}`)
      }
    } catch (err) {
      errors++
      if (errors <= 10) console.warn(`  ${c.email}: ${(err as Error).message}`)
    }
  }

  console.log(`\n=== DONE in ${Math.round((Date.now() - t0) / 1000)}s ===`)
  console.log(`  probed:   ${contacts.length}`)
  console.log(`  resolved: ${resolved}`)
  console.log(`  missing:  ${missing}`)
  console.log(`  errors:   ${errors}`)
  if (dryRun) console.log(`(dry-run)`)
} catch (err) {
  console.error('FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
