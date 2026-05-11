// Pure raw-SQL helper used by `apply-event.ts` (the rebuild + cron path) to
// keep contacts + cart_contact links in sync without going through the
// framework command bus. The live path goes through
// `upsertContactFromCartSignal` (command); this is the bulk-replay twin.
//
// Idempotency rules (mirror upsert-contact-helper.ts):
//   - email is lowercased before any lookup.
//   - first-write-wins on identity fields (phone, names, location, ids).
//   - last_activity_at is always bumped to `now`.
//   - cart_contact link is created if missing, repointed if the cart was
//     previously linked to a different contact.
//
// Returns counters so callers can log what happened.
//
// Why raw SQL: `apply-event.ts` already runs on a raw postgres-js client to
// bypass the 300ms Manta short-circuit on serverless. Mirroring the command
// in raw SQL keeps the bulk + rebuild paths self-contained.

export interface RawDb {
  raw: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}

export interface ContactSignal {
  cart_id: string
  email: string
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
  city?: string | null
  country_code?: string | null
  distinct_id?: string | null
  shopify_customer_id?: string | null
}

export interface UpsertContactOutcome {
  contact_id: string
  /** True iff a new contacts row was inserted. */
  created: boolean
  /** True iff the cart_contact link was inserted or repointed. */
  link_changed: boolean
  /** True iff contacts.distinct_id was filled by this call (first-write-wins). */
  distinct_id_set: boolean
}

interface ContactRow {
  id: string
  email: string
  phone: string | null
  first_name: string | null
  last_name: string | null
  country_code: string | null
  city: string | null
  shopify_customer_id: string | null
  distinct_id: string | null
}

/**
 * Upsert a contact (keyed by lowercased email) + ensure the cart_contact
 * link exists. Mirrors `upsertContactAndLink` from upsert-contact-helper.ts
 * but using raw SQL so it can run in the cron / rebuild path.
 */
export async function upsertContactFromEvent(
  db: RawDb,
  input: ContactSignal,
  now: Date = new Date(),
): Promise<UpsertContactOutcome | null> {
  const email = input.email.trim().toLowerCase()
  if (!email) {
    // Caller is expected to gate on `email` truthiness — return null so the
    // bulk loop can record a "skipped" outcome without throwing. Avoids
    // having to surface MantaError from a helper that's imported by raw
    // tsx scripts (which don't load framework globals).
    return null
  }

  // 1. Lookup existing contact by email
  const existing = await db.raw<ContactRow>(
    `SELECT id, email, phone, first_name, last_name, country_code, city, shopify_customer_id, distinct_id
       FROM contacts WHERE LOWER(email) = $1 LIMIT 1`,
    [email],
  )
  const ex = existing[0]

  let contactId: string
  let created = false
  let distinctIdSet = false

  if (ex) {
    // First-write-wins merge: only fill nulls.
    const nextPhone = ex.phone ?? input.phone ?? null
    const nextFirst = ex.first_name ?? input.first_name ?? null
    const nextLast = ex.last_name ?? input.last_name ?? null
    const nextCountry = ex.country_code ?? input.country_code ?? null
    const nextCity = ex.city ?? input.city ?? null
    const nextShopify = ex.shopify_customer_id ?? input.shopify_customer_id ?? null
    const nextDistinct = ex.distinct_id ?? input.distinct_id ?? null
    distinctIdSet = ex.distinct_id == null && input.distinct_id != null

    await db.raw(
      `UPDATE contacts
         SET phone = $1,
             first_name = $2,
             last_name = $3,
             country_code = $4,
             city = $5,
             shopify_customer_id = $6,
             distinct_id = $7,
             last_activity_at = $8,
             updated_at = $8
       WHERE id = $9`,
      [nextPhone, nextFirst, nextLast, nextCountry, nextCity, nextShopify, nextDistinct, now, ex.id],
    )
    contactId = ex.id
  } else {
    const inserted = await db.raw<{ id: string }>(
      `INSERT INTO contacts (
         id, email, phone, locale, first_name, last_name, country_code, city,
         shopify_customer_id, distinct_id,
         orders_count, total_spent,
         klaviyo_subscribed, klaviyo_suppressed,
         last_activity_at, created_at, updated_at
       ) VALUES (
         gen_random_uuid(), $1, $2, 'fr-FR', $3, $4, $5, $6,
         $7, $8,
         0, 0,
         false, false,
         $9, $9, $9
       )
       ON CONFLICT (email) DO UPDATE SET last_activity_at = EXCLUDED.last_activity_at
       RETURNING id`,
      [
        email,
        input.phone ?? null,
        input.first_name ?? null,
        input.last_name ?? null,
        input.country_code ?? null,
        input.city ?? null,
        input.shopify_customer_id ?? null,
        input.distinct_id ?? null,
        now,
      ],
    )
    contactId = inserted[0]?.id ?? ''
    created = true
    distinctIdSet = input.distinct_id != null
  }

  // 2. Ensure cart_contact link exists, repoint if it points elsewhere.
  let linkChanged = false
  const links = await db.raw<{ contact_id: string }>('SELECT contact_id FROM cart_contact WHERE cart_id = $1 LIMIT 1', [
    input.cart_id,
  ])
  if (links.length === 0) {
    await db.raw(
      `INSERT INTO cart_contact (id, cart_id, contact_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $3)`,
      [input.cart_id, contactId, now],
    )
    linkChanged = true
  } else if (links[0].contact_id !== contactId) {
    await db.raw('DELETE FROM cart_contact WHERE cart_id = $1', [input.cart_id])
    await db.raw(
      `INSERT INTO cart_contact (id, cart_id, contact_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $3)`,
      [input.cart_id, contactId, now],
    )
    linkChanged = true
  }

  return { contact_id: contactId, created, link_changed: linkChanged, distinct_id_set: distinctIdSet }
}
