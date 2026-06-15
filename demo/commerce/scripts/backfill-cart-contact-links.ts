// One-shot backfill — for every Cart with `email IS NOT NULL` but no entry
// in `cart_contact`, either link an existing Contact (case-insensitive email
// match) or create a new one then link.
//
// Additionally:
//   - If Cart.distinct_id is set AND Contact.distinct_id is null → fill it
//     (first-write-wins).
//   - If Contact.shopify_customer_id is set AND Cart.shopify_customer_id is
//     null → fill it (first-write-wins).
//
// Run with:
//   pnpm exec tsx scripts/backfill-cart-contact-links.ts          # local DB
//   pnpm exec tsx scripts/backfill-cart-contact-links.ts --prod
//   pnpm exec tsx scripts/backfill-cart-contact-links.ts --prod --dry-run

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import {
  type BackfillRepo,
  backfillCartContactLink,
  type CartRow,
} from '../src/modules/contact/backfill-cart-contact-link'

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

// Same spam-email guard used in apply-event.ts — avoid backfilling junk
// from automated bots that hit the storefront.
const SPAM_EMAIL_RE = /storebotmail|joonix\.net|mailinator|guerrillamail/i

const needsSsl = useProd || /neon\.tech|amazonaws\.com|render\.com|railway\.app/.test(DATABASE_URL)
const sql = postgres(DATABASE_URL, { ssl: needsSsl ? 'require' : undefined, max: 4, prepare: false })

// Build a repo over the live postgres connection. In dry-run mode each mutation
// is short-circuited to a no-op so the orchestration logic still walks the
// same code path (counters increment) but nothing is written.
function makeRepo(dryRun: boolean): BackfillRepo {
  return {
    findContactByLowerEmail: async (email) => {
      const rows = (await sql`
        SELECT id, email, shopify_customer_id, distinct_id
          FROM contacts WHERE LOWER(email) = ${email} LIMIT 1`) as Array<{
        id: string
        email: string
        shopify_customer_id: string | null
        distinct_id: string | null
      }>
      return rows[0] ?? null
    },
    insertContact: async (cart, lowerEmail) => {
      if (dryRun) return { id: '(dry-run)' }
      const inserted = (await sql`
        INSERT INTO contacts (
          id, email, phone, locale, first_name, last_name, country_code, city,
          shopify_customer_id, distinct_id,
          klaviyo_subscribed, klaviyo_suppressed,
          last_activity_at, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${lowerEmail}, ${cart.phone}, 'fr-FR',
          ${cart.first_name}, ${cart.last_name}, ${cart.country_code}, ${cart.city},
          ${cart.shopify_customer_id}, ${cart.distinct_id},
          false, false,
          NOW(), NOW(), NOW()
        )
        ON CONFLICT (email) DO UPDATE SET last_activity_at = NOW()
        RETURNING id`) as Array<{ id: string }>
      return inserted[0] ?? { id: '' }
    },
    updateContactDistinctId: async (contactId, distinctId) => {
      if (dryRun) return
      await sql`
        UPDATE contacts SET distinct_id = ${distinctId}, updated_at = NOW()
         WHERE id = ${contactId} AND distinct_id IS NULL`
    },
    updateCartShopifyCustomerId: async (cartId, shopifyCustomerId) => {
      if (dryRun) return
      await sql`
        UPDATE carts SET shopify_customer_id = ${shopifyCustomerId}
         WHERE id = ${cartId} AND shopify_customer_id IS NULL`
    },
    hasLink: async (cartId) => {
      const rows = await sql`SELECT 1 AS one FROM cart_contact WHERE cart_id = ${cartId} LIMIT 1`
      return rows.length > 0
    },
    insertLink: async (cartId, contactId) => {
      if (dryRun) return
      await sql`
        INSERT INTO cart_contact (id, cart_id, contact_id, created_at, updated_at)
        VALUES (gen_random_uuid(), ${cartId}, ${contactId}, NOW(), NOW())`
    },
  }
}

try {
  console.log(`[backfill-cart-contact-links] target: ${useProd ? 'PROD' : 'LOCAL'}  dryRun: ${dryRun}`)
  const t0 = Date.now()

  // Pull every cart with email but no cart_contact entry.
  const carts = (await sql`
    SELECT c.id, c.email, c.first_name, c.last_name, c.phone, c.city, c.country_code,
           c.distinct_id, c.shopify_customer_id
      FROM carts c
     WHERE c.email IS NOT NULL
       AND c.email <> ''
       AND NOT EXISTS (
         SELECT 1 FROM cart_contact cc WHERE cc.cart_id = c.id
       )
  `) as CartRow[]
  console.log(`[backfill-cart-contact-links] carts to process: ${carts.length}`)

  const repo = makeRepo(dryRun)

  let cartsScanned = 0
  let contactsCreated = 0
  let linksInserted = 0
  let cartsShopifyCustomerIdSet = 0
  let contactsDistinctIdSet = 0
  let spamSkipped = 0
  let errors = 0

  for (const cart of carts) {
    cartsScanned++
    const email = cart.email.trim().toLowerCase()
    if (!email || SPAM_EMAIL_RE.test(email)) {
      spamSkipped++
      continue
    }

    try {
      const out = await backfillCartContactLink(repo, cart)
      if (out) {
        if (out.contact_created) contactsCreated++
        if (out.link_inserted) linksInserted++
        if (out.contact_distinct_id_set) contactsDistinctIdSet++
        if (out.cart_shopify_customer_id_set) cartsShopifyCustomerIdSet++
      }
    } catch (err) {
      errors++
      if (errors <= 10) {
        console.warn(`  error on cart ${cart.id} email=${email}: ${(err as Error).message}`)
      }
    }
  }

  console.log(`\n=== DONE in ${Math.round((Date.now() - t0) / 1000)}s ===`)
  console.log(`carts_scanned:                  ${cartsScanned}`)
  console.log(`contacts_created:               ${contactsCreated}`)
  console.log(`links_inserted:                 ${linksInserted}`)
  console.log(`carts_shopify_customer_id_set:  ${cartsShopifyCustomerIdSet}`)
  console.log(`contacts_distinct_id_set:       ${contactsDistinctIdSet}`)
  console.log(`spam_skipped:                   ${spamSkipped}`)
  console.log(`errors:                         ${errors}`)
  if (dryRun) {
    console.log(`\n(dry-run — no rows written)`)
  }
} catch (err) {
  console.error('FAILED:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
