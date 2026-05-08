// Pure helper used by the upsertContactFromCartSignal command and its
// unit tests. The command itself is the framework boundary (defineCommand
// + step.* proxies); the merge logic — which we want covered by tests —
// lives here so we can drive it with plain mocks.
//
// "Idempotent contact upsert" means:
//   - email is normalised to lowercase (downstream lookups always go
//     through the lowercased value).
//   - non-null fields on an existing contact are preserved.
//   - last_activity_at is always bumped to `now`.
//   - the `cartContact` link is created if missing, or repointed if the
//     cart was previously linked to a different contact.

export interface CartSignalInput {
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

export interface ContactRow {
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

export interface CartContactRow {
  cart_id: string
  contact_id: string
}

export interface ContactRepo {
  list: (filters: Record<string, unknown>) => Promise<ContactRow[]>
  create: (data: Record<string, unknown>) => Promise<ContactRow>
  update: (id: string, data: Record<string, unknown>) => Promise<ContactRow>
}

export interface CartContactLinkOps {
  list: (where: Record<string, unknown>) => Promise<CartContactRow[]>
  link: (input: { cart_id: string; contact_id: string }) => Promise<unknown>
  unlink: (input: { cart_id: string; contact_id: string }) => Promise<unknown>
}

/**
 * Build the patch we want to apply to a contact row, given the current
 * existing row (if any) and the new signal. Pure function — caller
 * decides whether to `create` or `update`.
 */
export function buildContactPatch(
  existing: ContactRow | undefined,
  input: CartSignalInput,
  now: Date,
): Record<string, unknown> {
  const email = input.email.trim().toLowerCase()
  const merge = <T>(existingVal: T | null | undefined, newVal: T | null | undefined): T | null =>
    existingVal != null ? existingVal : (newVal ?? null)

  return {
    email,
    phone: merge(existing?.phone, input.phone),
    first_name: merge(existing?.first_name, input.first_name),
    last_name: merge(existing?.last_name, input.last_name),
    country_code: merge(existing?.country_code, input.country_code),
    city: merge(existing?.city, input.city),
    distinct_id: merge(existing?.distinct_id, input.distinct_id),
    shopify_customer_id: merge(existing?.shopify_customer_id, input.shopify_customer_id),
    last_activity_at: now,
  }
}

export interface UpsertContactResult {
  contact_id: string
  /** True iff a contact row was created in this call. False on update. */
  created: boolean
  /** True iff the cart->contact link was newly created or repointed. */
  link_changed: boolean
}

/**
 * Run the canonical "upsert + link" logic. Errors propagate — the
 * caller (the command boundary) is responsible for swallowing them
 * if the side-channel mirror should never fail the main flow.
 */
export async function upsertContactAndLink(args: {
  contact: ContactRepo
  link: CartContactLinkOps
  input: CartSignalInput
  now?: Date
}): Promise<UpsertContactResult> {
  const now = args.now ?? new Date()
  const email = args.input.email.trim().toLowerCase()

  const existing = (await args.contact.list({ email }))[0]
  const patch = buildContactPatch(existing, args.input, now)

  let contactId: string
  if (existing) {
    await args.contact.update(existing.id, patch)
    contactId = existing.id
  } else {
    const created = await args.contact.create(patch)
    contactId = created.id
  }

  const existingLinks = await args.link.list({ cart_id: args.input.cart_id })
  let linkChanged = false
  if (existingLinks.length === 0) {
    await args.link.link({ cart_id: args.input.cart_id, contact_id: contactId })
    linkChanged = true
  } else if (existingLinks[0].contact_id !== contactId) {
    await args.link.unlink({ cart_id: args.input.cart_id, contact_id: existingLinks[0].contact_id })
    await args.link.link({ cart_id: args.input.cart_id, contact_id: contactId })
    linkChanged = true
  }

  return { contact_id: contactId, created: !existing, link_changed: linkChanged }
}
