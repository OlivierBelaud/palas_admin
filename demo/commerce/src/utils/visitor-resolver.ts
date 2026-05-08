// Visitor identity resolver — backs the public /api/cart-tracking/c endpoint.
//
// Three identification channels, each producing the same `VisitorPayload`:
//   1. ?k=<klaviyo_exchange_id>  — historical Klaviyo $exchange_id (cached
//                                  in DB via klaviyo_exchange_resolved before
//                                  hitting the Klaviyo API).
//   2. ?u=<manta_uid_token>      — symmetric HMAC token issued by signContactToken.
//   3. ?d=<distinct_id>          — direct PostHog distinct_id lookup.
//
// All three end on a `Contact` lookup against the local DB, so the hot path
// reads orders_count / last_order_at without any synchronous HogQL call.
// Returns the payload to encode under { t, n?, o?, v }.

import { resolveKlaviyoProfile } from './klaviyo-resolve'
import { verifyContactToken } from './manta-uid'
import { codifyDate, codifyTier, nowEpochSec, type Tier } from './visitor-codes'

export interface VisitorPayload {
  t: Tier
  n?: number
  o?: number
  v: number
}

interface ContactLookupRow {
  email: string
  orders_count: number | null
  last_order_at: Date | string | null
}

interface KlaviyoExchangeRow {
  email: string
}

/**
 * Minimal shape of the Contact module service that the resolver needs.
 * Maps to the auto-generated `step.service.contact` runtime proxy, which
 * also exposes `listKlaviyoExchangeResolveds` / `createKlaviyoExchangeResolveds`
 * for the secondary entity in the same module.
 */
export interface ContactModuleLike {
  listContacts: (filters: Record<string, unknown>) => Promise<ContactLookupRow[]>
  listKlaviyoExchangeResolveds: (filters: Record<string, unknown>) => Promise<KlaviyoExchangeRow[]>
  createKlaviyoExchangeResolveds: (data: Record<string, unknown>) => Promise<unknown>
}

/** Build a VisitorPayload from a contact row (or anonymous when no row). */
export function buildPayloadFromContact(contact: ContactLookupRow | null): VisitorPayload {
  if (!contact) return { t: 'a', v: nowEpochSec() }

  const ordersCount = contact.orders_count ?? 0
  const payload: VisitorPayload = {
    t: codifyTier(ordersCount > 0, true),
    v: nowEpochSec(),
  }
  if (ordersCount > 0) {
    payload.n = ordersCount
    const iso = contact.last_order_at instanceof Date ? contact.last_order_at.toISOString() : contact.last_order_at
    const o = codifyDate(iso ?? null)
    if (o !== null) payload.o = o
  }
  return payload
}

async function findContactByEmail(module: ContactModuleLike, email: string): Promise<ContactLookupRow | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null
  const rows = await module.listContacts({ email: normalized })
  return rows[0] ?? null
}

/**
 * Resolve a Klaviyo exchange_id to an email — DB cache first, Klaviyo API
 * fallback. On API success we persist the resolution so subsequent visitors
 * with the same `k` skip the round-trip.
 *
 * Distinguishes three outcomes (preserving the previous /c contract):
 *   - 'cached'      — DB hit, email known.
 *   - 'resolved'    — Klaviyo API hit + email captured (anonymous if email empty).
 *   - 'api-failure' — Klaviyo API down/throwing; caller should cache shorter.
 */
export type ExchangeResolution =
  | { kind: 'cached'; email: string }
  | { kind: 'resolved'; email: string | null }
  | { kind: 'api-failure' }

export async function resolveExchangeIdToEmail(
  module: ContactModuleLike,
  exchangeId: string,
): Promise<ExchangeResolution> {
  const cached = await module.listKlaviyoExchangeResolveds({ exchange_id: exchangeId })
  const cachedEmail = cached[0]?.email
  if (cachedEmail) return { kind: 'cached', email: cachedEmail }

  const profile = await resolveKlaviyoProfile(exchangeId)
  if (!profile) return { kind: 'api-failure' }
  if (!profile.identified || !profile.email) return { kind: 'resolved', email: null }

  const email = profile.email.trim().toLowerCase()
  if (email) {
    try {
      await module.createKlaviyoExchangeResolveds({
        exchange_id: exchangeId,
        email,
        resolved_at: new Date(),
        expires_at: null,
      })
    } catch {
      // Best-effort cache write — duplicate or transient DB error should not
      // affect the response.
    }
  }
  return { kind: 'resolved', email: email || null }
}

export async function resolveByKlaviyoExchangeId(
  module: ContactModuleLike,
  exchangeId: string,
): Promise<{ payload: VisitorPayload; transient: boolean }> {
  const resolution = await resolveExchangeIdToEmail(module, exchangeId)
  if (resolution.kind === 'api-failure') {
    return { payload: { t: 'a', v: nowEpochSec() }, transient: true }
  }
  const email = resolution.email
  if (!email) {
    return { payload: { t: 'a', v: nowEpochSec() }, transient: false }
  }
  const contact = await findContactByEmail(module, email)
  return { payload: buildPayloadFromContact(contact), transient: false }
}

export async function resolveByMantaUidToken(module: ContactModuleLike, token: string): Promise<VisitorPayload> {
  const verified = verifyContactToken(token)
  if (!verified) return { t: 'a', v: nowEpochSec() }
  const contact = await findContactByEmail(module, verified.email)
  return buildPayloadFromContact(contact)
}

export async function resolveByDistinctId(module: ContactModuleLike, distinctId: string): Promise<VisitorPayload> {
  const trimmed = distinctId.trim()
  if (!trimmed) return { t: 'a', v: nowEpochSec() }
  const rows = await module.listContacts({ distinct_id: trimmed })
  return buildPayloadFromContact(rows[0] ?? null)
}
