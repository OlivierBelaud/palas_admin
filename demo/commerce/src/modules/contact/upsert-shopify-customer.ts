// Shared upsert logic for a Shopify customer payload → contacts mirror.
//
// Used by:
//   - api/shopify-webhooks/customers/route.ts  (real-time, customers/create + customers/update)
//   - scripts/backfill-shopify-customers.ts    (one-shot historical fill of the 250 missing)
//
// The SQL client is supplied by Manta's IDatabasePort. This keeps the module
// independent from a concrete database transport: Neon HTTP on Workers/
// serverless, postgres-js only behind the Node adapter.
//
// Matching strategy:
//   1) shopify_customer_id direct (most stable for repeat customers)
//   2) LOWER(email) (covers contacts seeded from cart pixel before Shopify
//      signed them up)
//   3) INSERT new row
//
// Idempotent. First-write-wins on identity (email/names/phone/locale) so the
// pixel-seeded values are never clobbered. E-commerce aggregates are not
// copied from Shopify customers because Shopify includes POS / private sale /
// wholesale channels; local `orders` classification + `order_contact` is the
// source of truth for analytics aggregates.

import type { RuntimeSql } from '../../utils/manta-runtime'
import { reattachHistoryForContact } from './reattach-history'

export interface ShopifyCustomerPayload {
  id: number | string
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  orders_count?: number | null
  total_spent?: string | number | null
  last_order_id?: number | string | null
  last_order_name?: string | null
  /** ISO timestamp of the last order; Shopify sends `last_order_at` on the
   * customer payload only via Admin REST when the customer has orders. */
  updated_at?: string | null
  locale?: string | null
  /** Default address — used to fill country_code / city when present. */
  default_address?: {
    city?: string | null
    country_code?: string | null
  } | null
}

export interface UpsertContactOutcome {
  /** How we located the row (or 'inserted' if none matched). */
  matched_via: 'shopify_customer_id' | 'email' | 'inserted' | 'noop'
  contact_id: string | null
  /** Whether a brand-new contact row was created. */
  created: boolean
  /** Number of carts retro-attached to this contact (via reattachHistoryForContact). */
  carts_reattached: number
}

export type SqlClient = RuntimeSql

interface ContactRow {
  id: string
  email: string
  shopify_customer_id: string | null
  phone: string | null
  first_name: string | null
  last_name: string | null
  locale: string | null
  country_code: string | null
  city: string | null
}

async function findByShopifyId(sql: SqlClient, shopifyCustomerId: string): Promise<ContactRow | null> {
  const rows = (await sql`
    SELECT id, email, shopify_customer_id, phone, first_name, last_name, locale, country_code, city
      FROM contacts
     WHERE shopify_customer_id = ${shopifyCustomerId}
     LIMIT 1`) as ContactRow[]
  return rows[0] ?? null
}

async function findByEmail(sql: SqlClient, email: string): Promise<ContactRow | null> {
  const rows = (await sql`
    SELECT id, email, shopify_customer_id, phone, first_name, last_name, locale, country_code, city
      FROM contacts
     WHERE LOWER(email) = LOWER(${email})
     LIMIT 1`) as ContactRow[]
  return rows[0] ?? null
}

export interface UpsertOptions {
  dryRun?: boolean
}

/**
 * Upsert one Shopify customer into the local `contacts` mirror. Reattaches
 * historical carts via `reattachHistoryForContact` so anonymous pixel carts
 * captured before the Contact existed get linked back to it.
 */
export async function upsertShopifyCustomer(
  sql: SqlClient,
  payload: ShopifyCustomerPayload,
  opts: UpsertOptions = {},
): Promise<UpsertContactOutcome> {
  const dryRun = opts.dryRun === true
  const shopifyCustomerId = String(payload.id)
  const email = (payload.email ?? '').trim().toLowerCase() || null
  if (!email) {
    // Shopify allows customers with no email (phone-only). Without an email
    // we can't reconcile against the cart pixel side — skip cleanly.
    return { matched_via: 'noop', contact_id: null, created: false, carts_reattached: 0 }
  }

  const locale = payload.locale ?? null
  const countryCode = payload.default_address?.country_code ?? null
  const city = payload.default_address?.city ?? null
  const phone = payload.phone ?? null
  const firstName = payload.first_name ?? null
  const lastName = payload.last_name ?? null
  const now = new Date()

  // Highest precedence: shopify_customer_id direct.
  let existing = await findByShopifyId(sql, shopifyCustomerId)
  let matchedVia: UpsertContactOutcome['matched_via'] = existing ? 'shopify_customer_id' : 'noop'
  if (!existing) {
    existing = await findByEmail(sql, email)
    if (existing) matchedVia = 'email'
  }

  let contactId: string | null = null
  let created = false

  if (existing) {
    if (dryRun) {
      return { matched_via: matchedVia, contact_id: existing.id, created: false, carts_reattached: 0 }
    }
    // First-write-wins on identity (email never overwritten; names/phone/locale
    // preserved if already set). Refresh shopify_customer_id (may have been
    // null on a pixel-seeded contact) and aggregates.
    await sql`
      UPDATE contacts
         SET shopify_customer_id = COALESCE(shopify_customer_id, ${shopifyCustomerId}),
             phone = COALESCE(phone, ${phone}),
             first_name = COALESCE(first_name, ${firstName}),
             last_name = COALESCE(last_name, ${lastName}),
             locale = CASE
               WHEN locale IS NULL OR locale = '' OR locale = 'fr-FR' THEN COALESCE(${locale}, locale)
               ELSE locale
             END,
             country_code = COALESCE(country_code, ${countryCode}),
             city = COALESCE(city, ${city}),
             shopify_synced_at = ${now},
             last_activity_at = ${now},
             updated_at = ${now}
       WHERE id = ${existing.id}`
    contactId = existing.id
  } else {
    if (dryRun) {
      return { matched_via: 'inserted', contact_id: null, created: true, carts_reattached: 0 }
    }
    const inserted = (await sql`
      INSERT INTO contacts (
        id, email, phone, locale, first_name, last_name, country_code, city,
        shopify_customer_id, orders_count, total_spent,
        klaviyo_subscribed, klaviyo_suppressed,
        shopify_synced_at, last_activity_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${email}, ${phone}, ${locale ?? 'fr-FR'}, ${firstName}, ${lastName},
        ${countryCode}, ${city},
        ${shopifyCustomerId}, 0, 0,
        false, false,
        ${now}, ${now}, ${now}, ${now}
      )
      ON CONFLICT (email) DO UPDATE SET
        shopify_customer_id = COALESCE(contacts.shopify_customer_id, EXCLUDED.shopify_customer_id),
        shopify_synced_at = EXCLUDED.shopify_synced_at,
        last_activity_at = EXCLUDED.last_activity_at,
        updated_at = EXCLUDED.updated_at
      RETURNING id`) as Array<{ id: string }>
    contactId = inserted[0]?.id ?? null
    created = inserted.length > 0 && matchedVia !== 'email'
    matchedVia = 'inserted'
  }

  // Retro-attach any historical carts that match by email — first-write-wins
  // on cart.shopify_customer_id. Wraps a try because reattach is best-effort
  // enrichment; the contact upsert is the source of truth.
  let cartsReattached = 0
  if (contactId && !dryRun) {
    try {
      const outcome = await reattachHistoryForContact(
        { raw: <T>(text: string, params?: unknown[]) => sql.unsafe(text, params as never) as unknown as Promise<T[]> },
        { email, shopify_customer_id: shopifyCustomerId },
      )
      cartsReattached = outcome.carts_attached
    } catch {
      // best-effort
    }
  }

  return { matched_via: matchedVia, contact_id: contactId, created, carts_reattached: cartsReattached }
}
