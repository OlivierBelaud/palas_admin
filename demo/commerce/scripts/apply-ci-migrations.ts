import { readFile } from 'node:fs/promises'
import postgres from 'postgres'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const manifest = JSON.parse(
  await readFile(new URL('../drizzle/migrations/ci-baseline.json', import.meta.url), 'utf8'),
) as { apply: string[] }
const sql = postgres(databaseUrl, { max: 1, prepare: false })

try {
  for (const migration of manifest.apply) {
    const source = await readFile(new URL(`../drizzle/migrations/${migration}`, import.meta.url), 'utf8')
    await sql.unsafe(source)
  }
} finally {
  await sql.end()
}
