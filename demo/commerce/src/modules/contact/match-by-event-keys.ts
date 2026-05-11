// Resolve a Contact id from whatever identity keys an inbound event
// carries. Used by the cart-tracking pipeline (apply-event) and by the
// PostHog upsert helper when an anonymous distinct_id eventually shows
// up next to an email we already know.
//
// Priority order — first match wins, never fall through:
//   1) email                  (most stable, canonical key)
//   2) shopify_customer_id    (server-confirmed identity)
//   3) klaviyo_exchange_id    (Klaviyo profile bridge — currently keyed
//                              to klaviyo_profile_id on the row)
//   4) distinct_id            (PostHog anonymous id — last resort because
//                              one Contact can have several over time)
//
// Read-only, idempotent. Direct SQL via postgres-js so callers can run it
// from raw cron contexts (no service container needed).

export interface MatchKeys {
  email?: string | null
  distinct_id?: string | null
  klaviyo_exchange_id?: string | null
  shopify_customer_id?: string | null
}

export interface MatchedContact {
  id: string
  email: string | null
}

export interface RawDb {
  raw: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}

async function findOne(db: RawDb, where: string, params: unknown[]): Promise<MatchedContact | null> {
  const rows = await db.raw<MatchedContact>(`SELECT id, email FROM contacts WHERE ${where} LIMIT 1`, params)
  return rows[0] ?? null
}

export async function matchContactByEventKeys(db: RawDb, keys: MatchKeys): Promise<MatchedContact | null> {
  const email = keys.email?.trim().toLowerCase() || null
  if (email) {
    const hit = await findOne(db, 'LOWER(email) = $1', [email])
    if (hit) return hit
  }

  const shopifyCustomerId = keys.shopify_customer_id?.trim() || null
  if (shopifyCustomerId) {
    const hit = await findOne(db, 'shopify_customer_id = $1', [shopifyCustomerId])
    if (hit) return hit
  }

  const klaviyoExchangeId = keys.klaviyo_exchange_id?.trim() || null
  if (klaviyoExchangeId) {
    const hit = await findOne(db, 'klaviyo_profile_id = $1', [klaviyoExchangeId])
    if (hit) return hit
  }

  const distinctId = keys.distinct_id?.trim() || null
  if (distinctId) {
    const hit = await findOne(db, 'distinct_id = $1', [distinctId])
    if (hit) return hit
  }

  return null
}
