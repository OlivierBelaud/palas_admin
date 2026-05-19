import { ShopifyAdminClient } from '../shopify-admin/client'
import { type ContactSignal, type ContactSnapshot, normalizeContactEmail, planContactMerge } from './merge-contact'

export interface RefreshContactInput {
  email: string
  reason?: string | null
  source?: string | null
  dryRun?: boolean
}

export interface RefreshContactOutcome {
  email: string
  contact_id: string | null
  created: boolean
  changed_fields: string[]
  ignored_fields: Array<{ field: string; reason: string }>
  sources: {
    shopify: boolean
    klaviyo: boolean
    posthog: boolean
  }
}

export interface ContactEntityRepo {
  list(
    filters: Record<string, unknown>,
    opts?: Record<string, unknown>,
  ): Promise<Array<ContactSnapshot & { id: string }>>
  create(data: Record<string, unknown>): Promise<{ id: string }>
  update(id: string, data: Record<string, unknown>): Promise<unknown>
}

export async function refreshContactFromSources(
  input: RefreshContactInput,
  repo: ContactEntityRepo,
  log: { warn: (msg: string) => void; info?: (msg: string) => void },
): Promise<RefreshContactOutcome> {
  const email = normalizeContactEmail(input.email)
  if (!email) throw new MantaError('INVALID_DATA', 'refreshContact requires an email')

  const existing = (await repo.list({ email }, { take: 1 }))[0] ?? null
  const sourceResults = await Promise.allSettled([
    fetchShopifyContactSignals(email),
    fetchKlaviyoContactSignal(email),
    fetchPosthogContactSignal(email),
  ])

  const signals: ContactSignal[] = []
  const sources = { shopify: false, klaviyo: false, posthog: false }
  const names = ['shopify', 'klaviyo', 'posthog'] as const
  for (let i = 0; i < sourceResults.length; i += 1) {
    const result = sourceResults[i]
    const name = names[i]
    if (result.status === 'fulfilled') {
      if (result.value.length > 0) {
        sources[name] = true
        signals.push(...result.value)
      }
    } else {
      log.warn(`[refreshContact] ${name} lookup failed for ${email}: ${result.reason}`)
    }
  }

  if (!existing && signals.length === 0) {
    signals.push({
      source: 'palas',
      source_kind: 'cart_email_capture',
      occurred_at: new Date(),
      email,
    })
  }

  let current: ContactSnapshot | null = existing
  const aggregatePatch: Record<string, unknown> = {}
  const changedFields = new Set<string>()
  const ignoredFields: Array<{ field: string; reason: string }> = []
  let createsContact = existing == null

  for (const signal of signals) {
    const plan = planContactMerge(current, signal)
    Object.assign(aggregatePatch, plan.patch)
    for (const field of plan.changed_fields) changedFields.add(field)
    for (const ignored of plan.ignored_fields) {
      ignoredFields.push({ field: ignored.field, reason: ignored.reason })
    }
    current = materializeSnapshot(current, email, plan.patch)
    createsContact = createsContact || plan.creates_contact
  }

  if (Object.keys(aggregatePatch).length === 0) {
    return {
      email,
      contact_id: existing?.id ?? null,
      created: false,
      changed_fields: [],
      ignored_fields: ignoredFields,
      sources,
    }
  }

  if (input.dryRun) {
    return {
      email,
      contact_id: existing?.id ?? null,
      created: createsContact,
      changed_fields: Array.from(changedFields),
      ignored_fields: ignoredFields,
      sources,
    }
  }

  let contactId = existing?.id ?? null
  if (existing) {
    await repo.update(existing.id, aggregatePatch)
  } else {
    const created = await repo.create({
      email,
      phone: null,
      locale: 'fr',
      first_name: null,
      last_name: null,
      country_code: null,
      city: null,
      shopify_customer_id: null,
      klaviyo_profile_id: null,
      distinct_id: null,
      orders_count: 0,
      total_spent: 0,
      klaviyo_subscribed: false,
      klaviyo_suppressed: false,
      ...aggregatePatch,
    })
    contactId = created.id
  }

  return {
    email,
    contact_id: contactId,
    created: existing == null,
    changed_fields: Array.from(changedFields),
    ignored_fields: ignoredFields,
    sources,
  }
}

function materializeSnapshot(
  current: ContactSnapshot | null,
  email: string,
  patch: Partial<ContactSnapshot>,
): ContactSnapshot {
  return {
    email,
    phone: null,
    locale: 'fr',
    first_name: null,
    last_name: null,
    country_code: null,
    city: null,
    shopify_customer_id: null,
    klaviyo_profile_id: null,
    distinct_id: null,
    orders_count: 0,
    total_spent: 0,
    first_order_at: null,
    last_order_at: null,
    klaviyo_subscribed: false,
    klaviyo_suppressed: false,
    email_marketing_opt_out_at: null,
    shopify_synced_at: null,
    klaviyo_synced_at: null,
    last_activity_at: null,
    ...(current ?? {}),
    ...patch,
  }
}

async function fetchShopifyContactSignals(email: string): Promise<ContactSignal[]> {
  const client = new ShopifyAdminClient({ domain: process.env.SHOPIFY_SHOP_DOMAIN ?? 'fancy-palas.myshopify.com' })
  const q = `email:"${email.replace(/"/g, '\\"')}"`
  const data = await client.query<{
    customers: {
      edges: Array<{
        node: {
          id: string
          email: string | null
          firstName: string | null
          lastName: string | null
          locale: string | null
          phone: string | null
          numberOfOrders: string | number
          amountSpent: { amount: string } | null
          defaultAddress: { city: string | null; countryCodeV2: string | null } | null
        }
      }>
    }
    firstOrder: { edges: Array<{ node: { createdAt: string } }> }
    lastOrder: { edges: Array<{ node: { createdAt: string } }> }
  }>(
    `query ContactRefresh($q: String!, $orderQ: String!) {
      customers(first: 1, query: $q) {
        edges {
          node {
            id email firstName lastName locale phone numberOfOrders
            amountSpent { amount }
            defaultAddress { city countryCodeV2 }
          }
        }
      }
      firstOrder: orders(first: 1, query: $orderQ, sortKey: CREATED_AT) {
        edges { node { createdAt } }
      }
      lastOrder: orders(first: 1, query: $orderQ, sortKey: CREATED_AT, reverse: true) {
        edges { node { createdAt } }
      }
    }`,
    { q, orderQ: q },
  )
  const customer = data.customers.edges[0]?.node
  if (!customer?.email) return []
  const firstOrderAt = data.firstOrder.edges[0]?.node.createdAt ?? null
  const lastOrderAt = data.lastOrder.edges[0]?.node.createdAt ?? null
  const id = customer.id.match(/(\d+)$/)?.[1] ?? customer.id
  const ordersCount = Number(customer.numberOfOrders) || 0
  const totalSpent = Number(customer.amountSpent?.amount ?? 0) || 0
  return [
    {
      source: 'shopify',
      source_kind: 'shopify_customer',
      source_id: id,
      occurred_at: new Date(),
      email: customer.email,
      phone: customer.phone,
      first_name: customer.firstName,
      last_name: customer.lastName,
      locale: customer.locale,
      country_code: customer.defaultAddress?.countryCodeV2 ?? null,
      city: customer.defaultAddress?.city ?? null,
      shopify_customer_id: id,
      orders_count: ordersCount,
      total_spent: totalSpent,
      first_order_at: firstOrderAt,
      last_order_at: lastOrderAt,
    },
  ]
}

async function fetchKlaviyoContactSignal(email: string): Promise<ContactSignal[]> {
  const key = process.env.KLAVIYO_API_KEY
  if (!key) return []
  const host = process.env.KLAVIYO_HOST ?? 'https://a.klaviyo.com'
  const filter = encodeURIComponent(`equals(email,"${email.replace(/"/g, '\\"')}")`)
  const res = await fetch(`${host}/api/profiles/?filter=${filter}&page[size]=1`, {
    headers: {
      Authorization: `Klaviyo-API-Key ${key}`,
      revision: '2024-10-15',
      accept: 'application/json',
    },
  })
  if (!res.ok) throw new MantaError('UNEXPECTED_STATE', `Klaviyo ${res.status}`)
  const body = (await res.json()) as {
    data?: Array<{
      id: string
      attributes?: Record<string, unknown>
    }>
  }
  const profile = body.data?.[0]
  if (!profile) return []
  const attrs = profile.attributes ?? {}
  return [
    {
      source: 'klaviyo',
      source_kind: 'klaviyo_profile',
      source_id: profile.id,
      occurred_at: new Date(),
      email,
      first_name: readString(attrs.first_name),
      last_name: readString(attrs.last_name),
      phone: readString(attrs.phone_number),
      locale: readString(attrs.locale) ?? readString(attrs.language),
      klaviyo_profile_id: profile.id,
      klaviyo_subscribed: readMarketingConsent(attrs) === 'SUBSCRIBED' ? true : null,
      klaviyo_suppressed: readBoolean(attrs.suppressed),
    },
  ]
}

async function fetchPosthogContactSignal(email: string): Promise<ContactSignal[]> {
  const key = process.env.POSTHOG_API_KEY
  if (!key) return []
  const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
  const safe = email.replace(/'/g, "''")
  const query = `
    SELECT distinct_id, timestamp, properties.$current_url
    FROM events
    WHERE lower(person.properties.email) = '${safe}'
    ORDER BY timestamp DESC
    LIMIT 1
  `
  const res = await fetch(`${host}/api/projects/@current/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  })
  if (!res.ok) throw new MantaError('UNEXPECTED_STATE', `PostHog ${res.status}`)
  const data = (await res.json()) as { results?: unknown[][] }
  const row = data.results?.[0]
  const distinctId = readString(row?.[0])
  if (!distinctId) return []
  return [
    {
      source: 'posthog',
      source_kind: 'posthog_navigation',
      source_id: distinctId,
      occurred_at: readString(row?.[1]) ?? new Date().toISOString(),
      email,
      posthog_distinct_id: distinctId,
      locale: localeFromUrl(readString(row?.[2])),
    },
  ]
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readMarketingConsent(attrs: Record<string, unknown>): string | null {
  const subscriptions = attrs.subscriptions as Record<string, unknown> | undefined
  const email = subscriptions?.email as Record<string, unknown> | undefined
  const marketing = email?.marketing as Record<string, unknown> | undefined
  return readString(marketing?.consent)
}

function localeFromUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const first = parsed.pathname.split('/').filter(Boolean)[0]
    if (first === 'fr') return 'fr'
    if (first === 'en' || first === 'uk') return 'en'
  } catch {
    return null
  }
  return null
}
