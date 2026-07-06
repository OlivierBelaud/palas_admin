import {
  evaluateMarketingExperience,
  type MarketingCampaign,
  type MarketingCartLine,
  type MarketingProduct,
  type PersonalOfferType,
} from '../marketing-experience/engine'

export interface PalasCartMarketingRule {
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

export interface PalasCartMarketingLine {
  id: string
  merchandiseId: string
  title: string
  variantTitle: string | null
  quantity: number
  price: number
  attributes: Array<{ key: string; value: string }>
}

export interface PalasCartMarketingCart {
  id: string
  subtotal: number
  currencyCode: string
  discountCodes: Array<{ code: string; applicable: boolean }>
  lines: PalasCartMarketingLine[]
}

export interface PalasCartMarketingInput {
  cart: PalasCartMarketingCart
  rules: PalasCartMarketingRule[]
  now?: string
  market?: string | null
  selectedPersonalOffers?: PersonalOfferType[]
}

export function resolvePalasCartMarketing(input: PalasCartMarketingInput) {
  const now = input.now ?? new Date().toISOString()
  const market = input.market ?? ''
  const products = productsFromCart(input.cart)
  const cartLines = cartLinesFromCart(input.cart)
  const campaigns = campaignsFromRules(input.rules, market)
  const selectedCodes = input.cart.discountCodes
    .filter((discountCode) => discountCode.applicable !== false)
    .map((discountCode) => discountCode.code.toUpperCase())

  const experience = evaluateMarketingExperience({
    now,
    market,
    currencyCode: input.cart.currencyCode,
    customerSegment: 'anonymous',
    cart: cartLines,
    campaigns,
    products,
    selectedCodes,
    selectedPersonalOffers: input.selectedPersonalOffers ?? [],
  })

  const reached = experience.progress.milestones
    .filter((milestone) => milestone.reached)
    .map((milestone) => ({
      id: milestone.id,
      type: milestone.kind === 'shipping' ? 'shipping_threshold' : 'gift_threshold',
      title: milestone.label,
      threshold: milestone.amount,
      remaining: 0,
      currencyCode: input.cart.currencyCode,
    }))
  const pending = experience.progress.milestones
    .filter((milestone) => !milestone.reached)
    .map((milestone) => ({
      id: milestone.id,
      type: milestone.kind === 'shipping' ? 'shipping_threshold' : 'gift_threshold',
      title: milestone.label,
      threshold: milestone.amount,
      remaining: milestone.remaining,
      currencyCode: input.cart.currencyCode,
    }))

  const linesToAdd = experience.gifts
    .filter((gift) => !cartHasGift(input.cart, gift.productId, gift.sourceRuleId))
    .map((gift) => ({
      merchandiseId: gift.productId,
      quantity: gift.quantity,
      attributes: [
        { key: '_free_gift_rule_id', value: gift.sourceRuleId },
        { key: '_free_gift_title', value: gift.title },
      ],
    }))

  const warnings = [
    ...experience.warnings,
    ...linesToAdd.map(
      (line) =>
        `Gift ${line.attributes[1]?.value ?? line.merchandiseId} reached but not auto-added by API: Storefront can add the line, not make it free without a matching pricing mechanism.`,
    ),
  ]

  return {
    experience: { ...experience, warnings },
    benefits: { reached, pending, warnings },
    cartPlan: { linesToAdd },
  }
}

function campaignsFromRules(rules: PalasCartMarketingRule[], market: string): MarketingCampaign[] {
  return rules
    .filter((rule) => rule.status === 'active')
    .filter((rule) => !rule.market_key || !market || rule.market_key === market)
    .map((rule, index) => campaignFromRule(rule, index))
    .filter((campaign): campaign is MarketingCampaign => Boolean(campaign))
}

function campaignFromRule(rule: PalasCartMarketingRule, index: number): MarketingCampaign | null {
  const startsAt = toIsoString(rule.starts_at) ?? new Date(0).toISOString()
  const endsAt = toIsoString(rule.ends_at)
  const personalOffer = personalOfferTypeForRule(rule)
  const base = {
    id: `palas-cart-${rule.id}`,
    title: rule.title,
    status: 'active' as const,
    startsAt,
    endsAt,
    priority: 200 - index,
  }

  if ((rule.rule_type === 'order_discount' || rule.rule_type === 'first_order_discount') && rule.value_type && rule.value != null) {
    return {
      ...base,
      rules: [
        {
          id: rule.id,
          kind: 'order_discount',
          label: rule.title,
          enabled: true,
          execution: [rule.execution_kind === 'shopify_discount' ? 'shopify_discount' : 'email_copy', 'theme_surface'],
          markets: rule.market_key ? [rule.market_key] : undefined,
          trigger: personalOffer
            ? { type: 'personal_offer', offer: personalOffer }
            : rule.code
              ? { type: 'code', code: rule.code.toUpperCase() }
              : { type: 'automatic' },
          exclusiveGroup: personalOffer ? 'personal_discount' : rule.code ? 'public_code_discount' : 'automatic_discount',
          valueType: rule.value_type,
          value: rule.value,
          target: { type: 'all' },
          code: rule.code,
          combinableWith: ['shipping_threshold'],
        },
      ],
    }
  }

  if (rule.rule_type === 'gift_threshold' && rule.threshold != null && rule.gift_product_id && rule.gift_title) {
    return {
      ...base,
      rules: [
        {
          id: rule.id,
          kind: 'gift_threshold',
          label: rule.gift_title,
          enabled: true,
          execution: ['cart_transform', 'theme_surface', 'email_copy'],
          markets: rule.market_key ? [rule.market_key] : undefined,
          trigger: { type: 'automatic' },
          threshold: rule.threshold,
          giftProductId: rule.gift_product_id,
          giftTitle: rule.gift_title,
        },
      ],
    }
  }

  if (rule.rule_type === 'shipping_threshold' && rule.threshold != null) {
    return {
      ...base,
      priority: 20,
      rules: [
        {
          id: rule.id,
          kind: 'shipping_threshold',
          label: rule.title,
          enabled: true,
          execution: ['shipping_profile', 'theme_surface', 'email_copy'],
          trigger: { type: 'automatic' },
          thresholds: {
            [rule.market_key ?? '']: {
              amount: rule.threshold,
              paidRate: rule.paid_rate ?? 0,
              currencyCode: rule.currency_code ?? 'EUR',
              source: rule.title,
            },
          },
        },
      ],
    }
  }

  return null
}

function productsFromCart(cart: PalasCartMarketingCart): MarketingProduct[] {
  return cart.lines.map((line) => ({
    id: line.merchandiseId,
    title: line.title,
    price: line.price,
    category: inferCategory(line.title, line.variantTitle),
    collectionIds: [],
  }))
}

function cartLinesFromCart(cart: PalasCartMarketingCart): MarketingCartLine[] {
  return cart.lines.map((line) => ({ productId: line.merchandiseId, quantity: line.quantity }))
}

function cartHasGift(cart: PalasCartMarketingCart, productId: string, ruleId: string): boolean {
  return cart.lines.some(
    (line) =>
      line.merchandiseId === productId &&
      line.attributes.some((attribute) => attribute.key === '_free_gift_rule_id' && attribute.value === ruleId),
  )
}

function personalOfferTypeForRule(rule: PalasCartMarketingRule): PersonalOfferType | null {
  const raw = rule.payload?.personal_offer
  if (raw === 'welcome' || raw === 'abandoned_cart' || raw === 'birthday') return raw
  const title = rule.title.toLowerCase()
  if (title.includes('bienvenue')) return 'welcome'
  if (title.includes('panier') || title.includes('abandon')) return 'abandoned_cart'
  if (title.includes('anniversaire') || title.includes('birthday')) return 'birthday'
  if (rule.rule_type === 'first_order_discount') return 'welcome'
  return null
}

function inferCategory(title: string, variantTitle: string | null): MarketingProduct['category'] {
  const haystack = `${title} ${variantTitle ?? ''}`.toLowerCase()
  if (haystack.includes('charm')) return 'charm'
  if (haystack.includes('tote') || haystack.includes('accessor')) return 'accessory'
  return 'jewelry'
}

function toIsoString(value: string | Date | null): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
