// Smoke script — render/store/send the daily reporting email.
//
// Usage:
//   pnpm exec tsx scripts/send-daily-reporting-email.ts --day=2026-06-14 --prod
//   pnpm exec tsx scripts/send-daily-reporting-email.ts --day=2026-06-14 --prod --send
//   pnpm exec tsx scripts/send-daily-reporting-email.ts --day=2026-06-14 --prod --send --to=me@example.com

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ResendNotificationAdapter } from '@mantajs/adapter-notification-resend'
import postgres from 'postgres'
import { dailyReportRecipientsFromEnv, renderDailyReportHtml, sendDailyReportEmail } from '../src/utils/daily-reporting'
import type { RuntimeSql } from '../src/utils/manta-runtime'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)

function loadEnv(relPath: string, { override }: { override: boolean }): boolean {
  const full = resolve(here, '..', relPath)
  try {
    const raw = readFileSync(full, 'utf8')
    for (const line of raw.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!match) continue
      if (override || !process.env[match[1]]) {
        let value = match[2].trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        process.env[match[1]] = value
      }
    }
    console.log(`[send-daily-reporting-email] loaded ${full}`)
    return true
  } catch {
    return false
  }
}

function argValue(name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)
}

const useProd = args.includes('--prod')
const doSend = args.includes('--send')
const day = argValue('--day')
const toOverride = argValue('--to')

loadEnv('.env', { override: false })
loadEnv('.env.local', { override: false })
if (useProd) loadEnv('.env.production', { override: true })

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing')
  process.exit(1)
}

const sql = postgres(process.env.DATABASE_URL, {
  ssl: useProd || /neon\.tech/.test(process.env.DATABASE_URL) ? 'require' : undefined,
  max: 2,
  prepare: false,
})

const notification = new ResendNotificationAdapter({
  apiKey: process.env.RESEND_API_KEY,
  defaultFrom: process.env.RESEND_FROM_EMAIL ?? 'PALAS <hello@fancypalas.com>',
  defaultReplyTo: process.env.RESEND_REPLY_TO,
})

try {
  const recipients = toOverride ? [toOverride] : dailyReportRecipientsFromEnv()
  const result = await sendDailyReportEmail({
    sql: sql as RuntimeSql,
    notification,
    day,
    recipients,
    dryRun: !doSend,
  })

  const previewPath = `/tmp/palas-daily-report-${result.payload.day}.html`
  writeFileSync(previewPath, renderDailyReportHtml(result.payload))

  console.log(
    JSON.stringify(
      {
        day: result.payload.day,
        dryRun: !doSend,
        recipients,
        snapshotStatus: result.snapshot_status,
        summary: result.payload.summary,
        sent: result.sent,
        previewPath,
      },
      null,
      2,
    ),
  )
} catch (err) {
  console.error('[send-daily-reporting-email] FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
