import { ShopifyAdminClient } from '../modules/shopify-admin/client'

export type DiscountSource = 'klaviyo_welcome' | 'shopify_generated'

export interface DiscountGrant {
  code: string
  source: DiscountSource
  shopifyDiscountId: string | null
}

export interface DiscountResolutionInput {
  email: string
  numberOfOrders: number
  log: { info?: (m: string) => void; warn: (m: string) => void }
  signal?: AbortSignal
}

const KLAVIYO_REVISION = '2024-10-15'
const WELCOME_COUPON_KEYS = [
  'welcome_coupon',
  'welcome_coupon_code',
  'welcome_discount_code',
  'welcome_code',
  'discount_code',
  'coupon_code',
  'coupon',
  'code_promo',
  'code',
  'Welcome Coupon',
  'Welcome Coupon Code',
  'Discount Code',
  'Coupon Code',
  'Code de bienvenue',
  'Code promo',
]

function sanitizeDiscountCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,64}$/.test(code)) return null
  return code
}

function readProperty(obj: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(obj, key)) return obj[key]
  const wanted = key.toLowerCase()
  const actual = Object.keys(obj).find((k) => k.toLowerCase() === wanted)
  return actual ? obj[actual] : undefined
}

export function findWelcomeCouponInProperties(properties: Record<string, unknown> | null | undefined): string | null {
  if (!properties) return null
  for (const key of WELCOME_COUPON_KEYS) {
    const code = sanitizeDiscountCode(readProperty(properties, key))
    if (code) return code
  }
  return null
}

async function lookupKlaviyoWelcomeCoupon(
  email: string,
  log: DiscountResolutionInput['log'],
  signal?: AbortSignal,
): Promise<string | null> {
  const key = process.env.KLAVIYO_API_KEY
  if (!key) return null
  const host = process.env.KLAVIYO_HOST ?? 'https://a.klaviyo.com'
  const filter = `equals(email,"${email.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`
  const url = `${host}/api/profiles?filter=${encodeURIComponent(filter)}&fields[profile]=email,properties`

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Klaviyo-API-Key ${key}`,
        revision: KLAVIYO_REVISION,
        accept: 'application/json',
      },
      signal,
    })
    if (!res.ok) {
      log.warn(`[discount] Klaviyo profile lookup failed email=${email} status=${res.status}`)
      return null
    }
    const body = (await res.json()) as {
      data?: Array<{ attributes?: { properties?: Record<string, unknown> | null } }>
    }
    return findWelcomeCouponInProperties(body.data?.[0]?.attributes?.properties)
  } catch (err) {
    log.warn(`[discount] Klaviyo profile lookup threw email=${email}: ${(err as Error).message}`)
    return null
  }
}

async function lookupShopifyNumberOfOrders(
  email: string,
  signal?: AbortSignal,
): Promise<
  { status: 'found'; numberOfOrders: number } | { status: 'none' } | { status: 'unavailable'; error: string }
> {
  try {
    const client = new ShopifyAdminClient()
    const data = await client.query<{
      customers: { edges: Array<{ node: { numberOfOrders: string | number | null } }> }
    }>(
      `query ShopifyCustomerOrders($q: String!) {
        customers(first: 1, query: $q) {
          edges { node { numberOfOrders } }
        }
      }`,
      { q: `email:"${email.replace(/"/g, '\\"')}"` },
      signal,
    )
    const raw = data.customers?.edges?.[0]?.node?.numberOfOrders
    if (raw === undefined || raw === null) return { status: 'none' }
    const numberOfOrders = typeof raw === 'number' ? raw : Number(raw)
    return { status: 'found', numberOfOrders: Number.isFinite(numberOfOrders) ? numberOfOrders : 0 }
  } catch (err) {
    return { status: 'unavailable', error: (err as Error).message }
  }
}

export async function lookupShopifyDiscountCode(
  code: string,
  signal?: AbortSignal,
): Promise<{ active: boolean; id: string | null }> {
  const client = new ShopifyAdminClient()
  const data = await client.query<{
    codeDiscountNodeByCode: {
      id: string
      codeDiscount: {
        __typename: string
        status?: string
        endsAt?: string | null
      } | null
    } | null
  }>(
    `query CodeDiscountByCode($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        id
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            status
            endsAt
          }
        }
      }
    }`,
    { code },
    signal,
  )
  const node = data.codeDiscountNodeByCode
  if (!node?.codeDiscount || node.codeDiscount.__typename !== 'DiscountCodeBasic') {
    return { active: false, id: node?.id ?? null }
  }
  return { active: node.codeDiscount.status === 'ACTIVE', id: node.id }
}

function buildGeneratedCode(email: string): string {
  const prefix = (process.env.ABANDONED_CART_DISCOUNT_PREFIX ?? 'PALAS10').replace(/[^A-Za-z0-9]/g, '').slice(0, 12)
  let hash = 2166136261
  for (const ch of email.toLowerCase()) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  const suffix = (hash >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(0, 7)
  return `${prefix}-${suffix}`
}

export async function createShopifyWelcomeDiscount(
  email: string,
  signal?: AbortSignal,
): Promise<{ code: string; id: string | null }> {
  const code = buildGeneratedCode(email)
  const existing = await lookupShopifyDiscountCode(code, signal).catch(() => null)
  if (existing?.active) return { code, id: existing.id }

  const client = new ShopifyAdminClient()
  const startsAt = new Date().toISOString()
  const endsAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
  const data = await client.query<{
    discountCodeBasicCreate: {
      codeDiscountNode: {
        id: string
        codeDiscount: { codes?: { nodes?: Array<{ code: string }> } } | null
      } | null
      userErrors: Array<{ field?: string[] | null; message: string }>
    }
  }>(
    `mutation CreateWelcomeDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              codes(first: 1) { nodes { code } }
            }
          }
        }
        userErrors { field message }
      }
    }`,
    {
      basicCodeDiscount: {
        title: `Palas welcome 10% - ${email}`,
        code,
        startsAt,
        endsAt,
        customerSelection: { all: true },
        customerGets: {
          value: { percentage: 0.1 },
          items: { all: true },
        },
        usageLimit: 1,
        appliesOncePerCustomer: true,
      },
    },
    signal,
  )
  const errors = data.discountCodeBasicCreate.userErrors
  if (errors.length > 0) {
    throw new MantaError('UNEXPECTED_STATE', errors.map((e) => e.message).join(' | '))
  }
  const node = data.discountCodeBasicCreate.codeDiscountNode
  return { code: node?.codeDiscount?.codes?.nodes?.[0]?.code ?? code, id: node?.id ?? null }
}

export async function resolveWelcomeDiscountForEmail(input: DiscountResolutionInput): Promise<DiscountGrant | null> {
  if (input.numberOfOrders > 0) return null

  const shopifyCustomer = await lookupShopifyNumberOfOrders(input.email, input.signal)
  if (shopifyCustomer.status === 'found' && shopifyCustomer.numberOfOrders > 0) return null
  if (shopifyCustomer.status === 'unavailable') {
    input.log.warn(`[discount] Shopify customer lookup failed email=${input.email}: ${shopifyCustomer.error}`)
    return null
  }

  const klaviyoCode = await lookupKlaviyoWelcomeCoupon(input.email, input.log, input.signal)
  if (klaviyoCode) {
    try {
      const checked = await lookupShopifyDiscountCode(klaviyoCode, input.signal)
      if (checked.active) return { code: klaviyoCode, source: 'klaviyo_welcome', shopifyDiscountId: checked.id }
      input.log.warn(
        `[discount] Klaviyo welcome coupon is not active in Shopify email=${input.email} code=${klaviyoCode}`,
      )
    } catch (err) {
      input.log.warn(
        `[discount] Shopify check failed for Klaviyo coupon email=${input.email}: ${(err as Error).message}`,
      )
      return null
    }
  }

  try {
    const created = await createShopifyWelcomeDiscount(input.email, input.signal)
    input.log.info?.(`[discount] generated Shopify welcome coupon email=${input.email} code=${created.code}`)
    return { code: created.code, source: 'shopify_generated', shopifyDiscountId: created.id }
  } catch (err) {
    input.log.warn(`[discount] Shopify welcome coupon create failed email=${input.email}: ${(err as Error).message}`)
    return null
  }
}
