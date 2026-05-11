// Pure backfill helper — for one cart row that has an email but no
// cart_contact entry, either link an existing Contact (case-insensitive
// email match) or create one then link.
//
// Extracted from `scripts/backfill-cart-contact-links.ts` so the orchestration
// can be unit-tested without booting postgres.

export interface CartRow {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  city: string | null
  country_code: string | null
  distinct_id: string | null
  shopify_customer_id: string | null
}

export interface ContactLookupRow {
  id: string
  email: string
  shopify_customer_id: string | null
  distinct_id: string | null
}

export interface BackfillRepo {
  findContactByLowerEmail: (email: string) => Promise<ContactLookupRow | null>
  insertContact: (cart: CartRow, lowerEmail: string) => Promise<{ id: string }>
  updateContactDistinctId: (contactId: string, distinctId: string) => Promise<void>
  updateCartShopifyCustomerId: (cartId: string, shopifyCustomerId: string) => Promise<void>
  hasLink: (cartId: string) => Promise<boolean>
  insertLink: (cartId: string, contactId: string) => Promise<void>
}

export interface BackfillResult {
  /** A new contacts row was inserted. */
  contact_created: boolean
  /** The cart_contact link row was inserted by this call. */
  link_inserted: boolean
  /** contacts.distinct_id was filled (first-write-wins). */
  contact_distinct_id_set: boolean
  /** carts.shopify_customer_id was filled (first-write-wins). */
  cart_shopify_customer_id_set: boolean
}

/**
 * Process one cart row: ensure a Contact exists for the email, ensure the
 * cart_contact link, opportunistically backfill cross-references.
 *
 * Idempotent — running twice on the same row is a no-op (link present →
 * skip, distinct_id already set → skip, etc.).
 */
export async function backfillCartContactLink(repo: BackfillRepo, cart: CartRow): Promise<BackfillResult | null> {
  const email = cart.email.trim().toLowerCase()
  if (!email) {
    // Caller filters empty-email carts upstream; return null instead of
    // throwing so the backfill loop reports a clean skip.
    return null
  }

  let contactId: string
  let contactCreated = false
  let contactDistinctIdSet = false
  let cartShopifyCustomerIdSet = false

  const existing = await repo.findContactByLowerEmail(email)
  if (existing) {
    contactId = existing.id

    // First-write-wins on contacts.distinct_id
    if (cart.distinct_id && !existing.distinct_id) {
      await repo.updateContactDistinctId(contactId, cart.distinct_id)
      contactDistinctIdSet = true
    }

    // First-write-wins on carts.shopify_customer_id
    if (existing.shopify_customer_id && !cart.shopify_customer_id) {
      await repo.updateCartShopifyCustomerId(cart.id, existing.shopify_customer_id)
      cartShopifyCustomerIdSet = true
    }
  } else {
    const inserted = await repo.insertContact(cart, email)
    contactId = inserted.id
    contactCreated = true
    contactDistinctIdSet = cart.distinct_id != null
  }

  let linkInserted = false
  const already = await repo.hasLink(cart.id)
  if (!already) {
    await repo.insertLink(cart.id, contactId)
    linkInserted = true
  }

  return {
    contact_created: contactCreated,
    link_inserted: linkInserted,
    contact_distinct_id_set: contactDistinctIdSet,
    cart_shopify_customer_id_set: cartShopifyCustomerIdSet,
  }
}
