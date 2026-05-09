// Smoke script — render an abandoned-cart email for one cart and (optionally)
// send it via Resend.
//
// Usage:
//   cd demo/commerce
//   pnpm exec tsx scripts/test-abandoned-cart-email.ts <cartId>                       # dry-run, writes /tmp/abandoned-cart-preview.html
//   pnpm exec tsx scripts/test-abandoned-cart-email.ts <cartId> --send                # send via Resend to the cart's real email (CAREFUL — real customers!)
//   pnpm exec tsx scripts/test-abandoned-cart-email.ts <cartId> --prod                # use Neon prod creds (still dry-run unless --send)
//   pnpm exec tsx scripts/test-abandoned-cart-email.ts <cartId> --locale=en           # force EN render (default = derived from contact/country)
//   pnpm exec tsx scripts/test-abandoned-cart-email.ts <cartId> --to=foo@bar.com      # override recipient — keeps cart data, swaps the To: header
//
// SAFETY: pair --send with --to= when probing a cart that belongs to a real
// customer. Without --to the email goes to whatever address is on the cart row.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ResendNotificationAdapter } from '@manta/adapter-notification-resend'
import postgres from 'postgres'
import { sendAbandonedCartEmailForCart } from '../src/emails/abandoned-cart/send-for-cart'

const here = dirname(fileURLToPath(import.meta.url))

function loadEnv(relPath: string, { override }: { override: boolean }): boolean {
  const full = resolve(here, '..', relPath)
  try {
    const raw = readFileSync(full, 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (override || !process.env[m[1]]) process.env[m[1]] = m[2]
    }
    console.log(`[test-abandoned-cart-email] loaded ${full}`)
    return true
  } catch {
    return false
  }
}

const useProd = process.argv.includes('--prod')
const doSend = process.argv.includes('--send')
const localeArg = process.argv.find((a) => a.startsWith('--locale='))?.split('=')[1]
const localeOverride = localeArg === 'fr' || localeArg === 'en' ? localeArg : undefined
const toOverride = process.argv.find((a) => a.startsWith('--to='))?.split('=')[1]
const cartId = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'))

if (!cartId) {
  console.error(
    'Usage: pnpm exec tsx scripts/test-abandoned-cart-email.ts <cartId> [--send] [--prod] [--locale=fr|en] [--to=email]',
  )
  process.exit(1)
}

loadEnv('.env', { override: false })
loadEnv('.env.local', { override: false })
if (useProd) loadEnv('.env.production', { override: true })

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL missing')
  process.exit(1)
}

const sql = postgres(DATABASE_URL, {
  ssl: useProd ? 'require' : undefined,
  max: 2,
  prepare: false,
})

interface DbCartRow {
  id: string
  cart_token: string
  checkout_token: string | null
  email: string | null
  first_name: string | null
  country_code: string | null
  items: unknown
  total_price: string | null
  currency: string | null
  abandon_notified_count: number | null
}

const consoleLog = {
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
}

try {
  const cartRows = (await sql`
    SELECT id, cart_token, checkout_token, email, first_name, country_code, items, total_price, currency, abandon_notified_count
    FROM carts
    WHERE id = ${cartId}
    LIMIT 1
  `) as unknown as DbCartRow[]

  if (cartRows.length === 0) {
    console.error(`Cart ${cartId} not found in ${useProd ? 'PROD' : 'LOCAL'} DB`)
    process.exit(1)
  }
  const dbCart = cartRows[0]

  // Resolve linked contact via cart_contact pivot (1:1). The pivot may not
  // exist on a fresh local DB without the CRM v1 bootstrap — treat as
  // "no linked contact" so the smoke test still works for template inspection.
  let contact: { locale?: string | null } | null = null
  try {
    const linkRows = (await sql`
      SELECT contact_id FROM cart_contact WHERE cart_id = ${cartId} AND deleted_at IS NULL LIMIT 1
    `) as unknown as Array<{ contact_id: string }>
    if (linkRows.length > 0) {
      const cRows = (await sql`
        SELECT locale FROM contacts WHERE id = ${linkRows[0].contact_id} LIMIT 1
      `) as unknown as Array<{ locale: string | null }>
      if (cRows.length > 0) contact = { locale: cRows[0].locale }
    }
  } catch (e) {
    console.warn(`[test-abandoned-cart-email] contact lookup skipped: ${(e as Error).message}`)
  }

  const cart = {
    ...dbCart,
    total_price: dbCart.total_price !== null ? Number(dbCart.total_price) : null,
    email: toOverride ?? dbCart.email,
  }
  if (toOverride) {
    console.log(
      `[test-abandoned-cart-email] recipient overridden via --to: ${dbCart.email ?? '(none)'} → ${toOverride}`,
    )
  }

  const notification = new ResendNotificationAdapter({
    apiKey: process.env.RESEND_API_KEY,
    defaultFrom: process.env.RESEND_FROM_EMAIL ?? 'PALAS <hello@fancypalas.com>',
    defaultReplyTo: process.env.RESEND_REPLY_TO,
  })

  const result = await sendAbandonedCartEmailForCart({
    cart,
    contact,
    notification,
    dryRun: !doSend,
    localeOverride,
    log: consoleLog,
  })

  console.log(
    JSON.stringify(
      {
        sent: result.sent,
        locale: result.locale,
        to: result.to,
        subject: result.subject,
        messageId: result.messageId,
        skipped: result.skipped,
        error: result.error,
      },
      null,
      2,
    ),
  )

  if (!doSend) {
    const previewPath = '/tmp/abandoned-cart-preview.html'
    writeFileSync(previewPath, result.html)
    console.log(`\nPreview HTML written to ${previewPath}`)
  }
} catch (err) {
  console.error('[test-abandoned-cart-email] FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
