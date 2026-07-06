// Palas cart proxy — public endpoint used by the Shopify theme dev branch.
//
// Shape: POST /api/cart-tracking/palas-cart
// Body:
//   {
//     action: 'sync' | 'add' | 'update' | 'remove' | 'discounts',
//     cartId?: string,
//     lines?: [{ merchandiseId? | variantId?, lineId?, quantity?, attributes? }],
//     discountCodes?: string[],
//     buyerIdentity?: { countryCode?, email? },
//     market?: string
//   }
//
// This route deliberately uses Storefront API carts instead of Shopify Ajax
// cart endpoints. The theme must render the drawer from the returned cart and
// send the buyer to `checkoutUrl`.

import { resolvePalasCartMarketing } from '../../palas-cart-marketing'
import type { PersonalOfferType } from '../../../marketing-experience/engine'

type CartAction = 'sync' | 'add' | 'update' | 'remove' | 'discounts'

interface PalasCartLineInput {
  merchandiseId?: unknown
  variantId?: unknown
  lineId?: unknown
  quantity?: unknown
  attributes?: unknown
}

interface PalasCartBuyerIdentityInput {
  countryCode?: unknown
  email?: unknown
}

interface PalasCartBody {
  action?: unknown
  cartId?: unknown
  lines?: unknown
  discountCodes?: unknown
  buyerIdentity?: PalasCartBuyerIdentityInput
  market?: unknown
  personalOffers?: unknown
}

interface MarketingRuleRow {
  id: string
  title: string
  rule_type: 'order_discount' | 'first_order_discount' | 'gift_threshold' | 'shipping_threshold'
  status: 'draft' | 'active' | 'paused'
  starts_at: string | Date
  ends_at: string | Date | null
  execution_kind: 'shopify_discount' | 'local_cart_rule' | 'shipping_profile'
  market_key: string | null
  currency_code: string | null
  value_type: 'percentage' | 'fixed_amount' | null
  value: number | null
  code: string | null
  threshold: number | null
  gift_product_id: string | null
  gift_title: string | null
  paid_rate: number | null
  payload?: Record<string, unknown> | null
}

interface StorefrontMoney {
  amount: string
  currencyCode: string
}

interface StorefrontCart {
  id: string
  checkoutUrl: string
  totalQuantity: number
  discountCodes: Array<{ code: string; applicable: boolean }>
  cost: {
    subtotalAmount: StorefrontMoney
    totalAmount: StorefrontMoney
    totalTaxAmount: StorefrontMoney | null
  }
  lines: {
    nodes: StorefrontCartLine[]
  }
}

interface StorefrontCartLine {
  id: string
  quantity: number
  attributes: Array<{ key: string; value: string }>
  cost: {
    subtotalAmount: StorefrontMoney
    totalAmount: StorefrontMoney
    amountPerQuantity: StorefrontMoney
  }
  merchandise: {
    __typename: string
    id: string
    title?: string
    image?: { url: string; altText: string | null } | null
    product?: {
      id: string
      title: string
      handle: string
    }
  }
}

interface StorefrontPayload {
  cart?: StorefrontCart | null
  userErrors?: Array<{ field?: string[] | null; message: string }>
}

type MarketingRuleRepo = {
  list?: (filters?: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<MarketingRuleRow[]>
}

const DEFAULT_API_VERSION = '2025-10'

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get('origin')),
  })
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = {
    ...corsHeaders(origin),
    'Content-Type': 'application/json',
  }

  if (!headers['Access-Control-Allow-Origin']) {
    return Response.json({ ok: false, error: 'FORBIDDEN' }, { status: 403, headers })
  }

  let body: PalasCartBody
  try {
    body = (await req.json()) as PalasCartBody
  } catch {
    return Response.json({ ok: false, error: 'INVALID_JSON' }, { status: 400, headers })
  }

  const action = readAction(body.action)
  if (!action) return Response.json({ ok: false, error: 'INVALID_ACTION' }, { status: 400, headers })

  try {
    const client = new StorefrontClient()
    const rules = await readMarketingRules(req, sanitize(body.market, 80))
    const normalizedLines = readLines(body.lines)
    const discountCodes = readStringArray(body.discountCodes, 250)
    const personalOffers = readPersonalOffers(body.personalOffers)
    const buyerIdentity = readBuyerIdentity(body.buyerIdentity)
    let cart = body.cartId ? await fetchCart(client, sanitize(body.cartId, 512) as string) : null

    if (!cart) {
      cart = await createCart(client, buyerIdentity)
    } else if (buyerIdentity) {
      cart = await updateBuyerIdentity(client, cart.id, buyerIdentity)
    }

    if (action === 'add' && normalizedLines.length > 0) {
      cart = await addLines(client, cart.id, normalizedLines)
    }

    if (action === 'update' && normalizedLines.length > 0) {
      cart = await updateLines(client, cart.id, normalizedLines)
    }

    if (action === 'remove') {
      const lineIds = normalizedLines.map((line) => line.lineId).filter((id): id is string => Boolean(id))
      if (lineIds.length > 0) cart = await removeLines(client, cart.id, lineIds)
    }

    const codeSet = mergeDiscountCodes(discountCodes, rules, personalOffers)
    if (action === 'discounts' || codeSet.length > 0) {
      cart = await updateDiscountCodes(client, cart.id, codeSet)
    }

    const normalizedCart = normalizeCart(cart)
    const resolvedMarketing = resolvePalasCartMarketing({
      cart: normalizedCart,
      rules,
      market: sanitize(body.market, 80),
      selectedPersonalOffers: personalOffers,
    })

    return Response.json(
      {
        ok: true,
        cart: normalizedCart,
        benefits: resolvedMarketing.benefits,
        marketingExperience: resolvedMarketing.experience,
        cartPlan: resolvedMarketing.cartPlan,
        warnings: resolvedMarketing.benefits.warnings,
      },
      { headers },
    )
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: 'PALAS_CART_FAILED',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500, headers },
    )
  }
}

class StorefrontClient {
  private readonly endpoint: string
  private readonly token: string

  constructor() {
    const domain = process.env.SHOPIFY_SHOP_DOMAIN
    const token = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN
    const apiVersion = process.env.SHOPIFY_STOREFRONT_API_VERSION ?? DEFAULT_API_VERSION
    if (!domain) throw new Error('SHOPIFY_SHOP_DOMAIN missing')
    if (!token) throw new Error('SHOPIFY_STOREFRONT_ACCESS_TOKEN missing')
    this.endpoint = `https://${domain}/api/${apiVersion}/graphql.json`
    this.token = token
  }

  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': this.token,
      },
      body: JSON.stringify({ query, variables }),
    })
    const body = (await response.json().catch(() => null)) as { data?: T; errors?: Array<{ message: string }> } | null
    if (!response.ok) throw new Error(`Storefront HTTP ${response.status}`)
    if (body?.errors?.length) throw new Error(body.errors.map((error) => error.message).join(' | '))
    if (!body?.data) throw new Error('Storefront empty response')
    return body.data
  }
}

async function fetchCart(client: StorefrontClient, cartId: string): Promise<StorefrontCart | null> {
  const data = await client.query<{ cart: StorefrontCart | null }>(CART_QUERY, { cartId })
  return data.cart
}

async function createCart(
  client: StorefrontClient,
  buyerIdentity: Record<string, string> | null,
): Promise<StorefrontCart> {
  const data = await client.query<{ cartCreate: StorefrontPayload }>(CART_CREATE_MUTATION, {
    input: buyerIdentity ? { buyerIdentity } : {},
  })
  return readStorefrontCartPayload(data.cartCreate)
}

async function updateBuyerIdentity(
  client: StorefrontClient,
  cartId: string,
  buyerIdentity: Record<string, string>,
): Promise<StorefrontCart> {
  const data = await client.query<{ cartBuyerIdentityUpdate: StorefrontPayload }>(CART_BUYER_IDENTITY_MUTATION, {
    cartId,
    buyerIdentity,
  })
  return readStorefrontCartPayload(data.cartBuyerIdentityUpdate)
}

async function addLines(
  client: StorefrontClient,
  cartId: string,
  lines: NormalizedLineInput[],
): Promise<StorefrontCart> {
  const storefrontLines = lines
    .filter((line) => line.merchandiseId && (line.quantity ?? 0) > 0)
    .map((line) => ({
      merchandiseId: line.merchandiseId,
      quantity: line.quantity,
      attributes: line.attributes,
    }))
  const data = await client.query<{ cartLinesAdd: StorefrontPayload }>(CART_LINES_ADD_MUTATION, {
    cartId,
    lines: storefrontLines,
  })
  return readStorefrontCartPayload(data.cartLinesAdd)
}

async function updateLines(
  client: StorefrontClient,
  cartId: string,
  lines: NormalizedLineInput[],
): Promise<StorefrontCart> {
  const storefrontLines = lines
    .filter((line) => line.lineId)
    .map((line) => ({
      id: line.lineId,
      quantity: Math.max(0, line.quantity ?? 0),
      attributes: line.attributes,
    }))
  const data = await client.query<{ cartLinesUpdate: StorefrontPayload }>(CART_LINES_UPDATE_MUTATION, {
    cartId,
    lines: storefrontLines,
  })
  return readStorefrontCartPayload(data.cartLinesUpdate)
}

async function removeLines(client: StorefrontClient, cartId: string, lineIds: string[]): Promise<StorefrontCart> {
  const data = await client.query<{ cartLinesRemove: StorefrontPayload }>(CART_LINES_REMOVE_MUTATION, {
    cartId,
    lineIds,
  })
  return readStorefrontCartPayload(data.cartLinesRemove)
}

async function updateDiscountCodes(
  client: StorefrontClient,
  cartId: string,
  discountCodes: string[],
): Promise<StorefrontCart> {
  const data = await client.query<{ cartDiscountCodesUpdate: StorefrontPayload }>(CART_DISCOUNTS_MUTATION, {
    cartId,
    discountCodes,
  })
  return readStorefrontCartPayload(data.cartDiscountCodesUpdate)
}

function readStorefrontCartPayload(payload: StorefrontPayload): StorefrontCart {
  if (payload.userErrors?.length) throw new Error(payload.userErrors.map((error) => error.message).join(' | '))
  if (!payload.cart) throw new Error('Storefront returned no cart')
  return payload.cart
}

interface NormalizedLineInput {
  merchandiseId: string | null
  lineId: string | null
  quantity: number | null
  attributes: Array<{ key: string; value: string }>
}

function readLines(value: unknown): NormalizedLineInput[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 250).map((line): NormalizedLineInput => {
    const raw = line as PalasCartLineInput
    const variantId = sanitize(raw.variantId, 80)
    const merchandiseId = sanitize(raw.merchandiseId, 180) ?? (variantId ? toVariantGid(variantId) : null)
    return {
      merchandiseId,
      lineId: sanitize(raw.lineId, 180),
      quantity: readQuantity(raw.quantity),
      attributes: readAttributes(raw.attributes),
    }
  })
}

function readAttributes(value: unknown): Array<{ key: string; value: string }> {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, 20)
    .map((attribute) => {
      const row = attribute as { key?: unknown; value?: unknown }
      const key = sanitize(row.key, 80)
      const attrValue = sanitize(row.value, 300)
      return key && attrValue ? { key, value: attrValue } : null
    })
    .filter((attribute): attribute is { key: string; value: string } => Boolean(attribute))
}

function toVariantGid(value: string): string {
  if (value.startsWith('gid://shopify/ProductVariant/')) return value
  return `gid://shopify/ProductVariant/${value.replace(/\D/g, '')}`
}

function readQuantity(value: unknown): number | null {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.max(0, Math.min(999, Math.floor(number)))
}

function readAction(value: unknown): CartAction | null {
  return value === 'sync' || value === 'add' || value === 'update' || value === 'remove' || value === 'discounts'
    ? value
    : null
}

function readStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .slice(0, limit)
        .map((item) => sanitize(item, 80)?.toUpperCase())
        .filter((item): item is string => Boolean(item)),
    ),
  )
}

function readPersonalOffers(value: unknown): PersonalOfferType[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .slice(0, 10)
        .map((item) => sanitize(item, 40)?.toLowerCase())
        .filter((item): item is PersonalOfferType =>
          item === 'welcome' || item === 'abandoned_cart' || item === 'birthday',
        ),
    ),
  )
}

function readBuyerIdentity(value: PalasCartBuyerIdentityInput | undefined): Record<string, string> | null {
  if (!value) return null
  const countryCode = sanitize(value.countryCode, 2)?.toUpperCase()
  const email = sanitize(value.email, 255)?.toLowerCase()
  const out: Record<string, string> = {}
  if (countryCode) out.countryCode = countryCode
  if (email) out.email = email
  return Object.keys(out).length > 0 ? out : null
}

function sanitize(value: unknown, max = 255): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const trimmed = String(value).trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

function mergeDiscountCodes(
  inputCodes: string[],
  rules: MarketingRuleRow[],
  personalOffers: PersonalOfferType[],
): string[] {
  const automaticRuleCodes = rules
    .filter((rule) => {
      if (rule.rule_type !== 'first_order_discount' || !rule.code) return false
      const offer = personalOfferTypeForRule(rule)
      return offer ? personalOffers.includes(offer) : false
    })
    .map((rule) => rule.code as string)
  return Array.from(new Set([...inputCodes, ...automaticRuleCodes].map((code) => code.toUpperCase())))
}

function personalOfferTypeForRule(rule: MarketingRuleRow): PersonalOfferType | null {
  const raw = rule.payload?.personal_offer
  if (raw === 'welcome' || raw === 'abandoned_cart' || raw === 'birthday') return raw
  const title = rule.title.toLowerCase()
  if (title.includes('bienvenue')) return 'welcome'
  if (title.includes('panier') || title.includes('abandon')) return 'abandoned_cart'
  if (title.includes('anniversaire') || title.includes('birthday')) return 'birthday'
  if (rule.rule_type === 'first_order_discount') return 'welcome'
  return null
}

async function readMarketingRules(req: Request, market: string | null): Promise<MarketingRuleRow[]> {
  const mantaReq = req as Request & { app?: { modules?: { marketingRule?: MarketingRuleRepo } } }
  const repo = mantaReq.app?.modules?.marketingRule
  if (!repo?.list) return []
  try {
    const rows = await repo.list({ status: 'active' }, { take: 100 })
    const now = Date.now()
    return rows.filter((rule) => {
      if (market && rule.market_key && rule.market_key !== market) return false
      const startsAt = new Date(rule.starts_at).getTime()
      const endsAt = rule.ends_at ? new Date(rule.ends_at).getTime() : Number.POSITIVE_INFINITY
      return startsAt <= now && now <= endsAt
    })
  } catch {
    return []
  }
}

function normalizeCart(cart: StorefrontCart) {
  return {
    id: cart.id,
    checkoutUrl: cart.checkoutUrl,
    totalQuantity: cart.totalQuantity,
    subtotal: Number(cart.cost.subtotalAmount.amount),
    total: Number(cart.cost.totalAmount.amount),
    currencyCode: cart.cost.totalAmount.currencyCode,
    discountCodes: cart.discountCodes,
    lines: cart.lines.nodes.map((line) => ({
      id: line.id,
      merchandiseId: line.merchandise.id,
      title: line.merchandise.product?.title ?? line.merchandise.title ?? 'Produit',
      variantTitle: line.merchandise.title ?? null,
      handle: line.merchandise.product?.handle ?? null,
      image: line.merchandise.image,
      quantity: line.quantity,
      price: Number(line.cost.amountPerQuantity.amount),
      subtotal: Number(line.cost.subtotalAmount.amount),
      total: Number(line.cost.totalAmount.amount),
      attributes: line.attributes,
      isFreeGift: line.attributes.some((attribute) => attribute.key.startsWith('_free_gift')),
    })),
  }
}

function isOriginAllowed(origin: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (p === origin) return true
    const m = p.match(/^(https?:\/\/)\*\.(.+)$/)
    if (!m) continue
    const [, scheme, rootHost] = m
    if (origin === `${scheme}${rootHost}`) return true
    if (origin.startsWith(scheme) && origin.slice(scheme.length).endsWith(`.${rootHost}`)) return true
  }
  return false
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = (process.env.ALLOWED_CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Palas-Cart-Dev',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'private, no-store',
  }
  if (origin && isOriginAllowed(origin, allowed)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

const CART_FRAGMENT = `
  fragment PalasCartFragment on Cart {
    id
    checkoutUrl
    totalQuantity
    discountCodes { code applicable }
    cost {
      subtotalAmount { amount currencyCode }
      totalAmount { amount currencyCode }
      totalTaxAmount { amount currencyCode }
    }
    lines(first: 100) {
      nodes {
        id
        quantity
        attributes { key value }
        cost {
          subtotalAmount { amount currencyCode }
          totalAmount { amount currencyCode }
          amountPerQuantity { amount currencyCode }
        }
        merchandise {
          __typename
          ... on ProductVariant {
            id
            title
            image { url altText }
            product { id title handle }
          }
        }
      }
    }
  }
`

const CART_QUERY = `
  ${CART_FRAGMENT}
  query PalasCart($cartId: ID!) {
    cart(id: $cartId) { ...PalasCartFragment }
  }
`

const CART_CREATE_MUTATION = `
  ${CART_FRAGMENT}
  mutation PalasCartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart { ...PalasCartFragment }
      userErrors { field message }
    }
  }
`

const CART_BUYER_IDENTITY_MUTATION = `
  ${CART_FRAGMENT}
  mutation PalasCartBuyerIdentityUpdate($cartId: ID!, $buyerIdentity: CartBuyerIdentityInput!) {
    cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
      cart { ...PalasCartFragment }
      userErrors { field message }
    }
  }
`

const CART_LINES_ADD_MUTATION = `
  ${CART_FRAGMENT}
  mutation PalasCartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart { ...PalasCartFragment }
      userErrors { field message }
    }
  }
`

const CART_LINES_UPDATE_MUTATION = `
  ${CART_FRAGMENT}
  mutation PalasCartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) {
      cart { ...PalasCartFragment }
      userErrors { field message }
    }
  }
`

const CART_LINES_REMOVE_MUTATION = `
  ${CART_FRAGMENT}
  mutation PalasCartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
      cart { ...PalasCartFragment }
      userErrors { field message }
    }
  }
`

const CART_DISCOUNTS_MUTATION = `
  ${CART_FRAGMENT}
  mutation PalasCartDiscountCodesUpdate($cartId: ID!, $discountCodes: [String!]!) {
    cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $discountCodes) {
      cart { ...PalasCartFragment }
      userErrors { field message }
    }
  }
`
