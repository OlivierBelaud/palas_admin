import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { refreshLifecycleFacts } from '../src/modules/visitor-session/lifecycle-facts'

const args = process.argv.slice(2)
const useProd = args.includes('--prod')

function loadEnv(file: string, override: boolean): void {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (override || !process.env[m[1]]) {
        let value = m[2].trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        process.env[m[1]] = value
      }
    }
  } catch {
    // ignore
  }
}

function readNumberFlag(name: string, fallback: number): number {
  const idx = args.indexOf(name)
  if (idx === -1) return fallback
  const raw = args[idx + 1]
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

loadEnv('.env', false)
if (useProd) loadEnv('.env.production', true)

const days = readNumberFlag('--days', 35)
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL missing')

const sql = postgres(databaseUrl, {
  ssl: useProd || /neon\.tech/.test(databaseUrl) ? 'require' : undefined,
  max: 4,
  prepare: false,
})

const to = new Date()
const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - days))
const result = await refreshLifecycleFacts({ raw: (query, params) => sql.unsafe(query, params) }, { from, to })
console.log(JSON.stringify(result, null, 2))
await sql.end({ timeout: 5 })
