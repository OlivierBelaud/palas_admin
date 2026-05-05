// Quick read of the email_captures table on prod. Temporary debug helper —
// remove once the admin page exists.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const here = dirname(fileURLToPath(import.meta.url))
const envLines = readFileSync(resolve(here, '..', '.env.production'), 'utf8').split('\n')
for (const line of envLines) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m) process.env[m[1]] = m[2]
}

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1, prepare: false })

try {
  const rows = await sql<
    {
      email: string
      cart_token: string | null
      source: string
      is_test: boolean
      klaviyo_synced_at: Date | null
      posthog_synced_at: Date | null
      created_at: Date
    }[]
  >`SELECT email, cart_token, source, is_test, klaviyo_synced_at, posthog_synced_at, created_at
    FROM email_captures ORDER BY created_at DESC LIMIT 10`

  console.log(`Rows: ${rows.length}`)
  for (const r of rows) {
    console.log(JSON.stringify(r))
  }
} finally {
  await sql.end()
}
