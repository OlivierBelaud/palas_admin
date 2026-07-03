export type MarketCode = string
export type CurrencyCode = string
export type CustomerSegment = 'anonymous' | 'new_customer' | 'returning_customer' | 'vip'
export type PersonalOfferType = 'welcome' | 'abandoned_cart' | 'birthday'
export type RuleKind =
  | 'order_discount'
  | 'shipping_threshold'
  | 'gift_threshold'
  | 'gift_with_purchase'
  | 'announcement'
export type ExecutionChannel =
  | 'shopify_discount'
  | 'shipping_profile'
  | 'cart_transform'
  | 'theme_surface'
  | 'email_copy'

export interface MarketingProduct {
  id: string
  title: string
  price: number
  category: 'jewelry' | 'charm' | 'accessory'
  collectionIds: string[]
}

export interface MarketingCartLine {
  productId: string
  quantity: number
}

export interface MarketingCampaign {
  id: string
  title: string
  status: 'draft' | 'active' | 'paused'
  startsAt: string
  endsAt: string | null
  priority: number
  rules: MarketingRule[]
}

export type MarketingRule =
  | OrderDiscountRule
  | ShippingThresholdRule
  | GiftThresholdRule
  | GiftWithPurchaseRule
  | AnnouncementRule

interface BaseRule {
  id: string
  kind: RuleKind
  label: string
  enabled: boolean
  execution: ExecutionChannel[]
  markets?: MarketCode[]
  customerSegments?: CustomerSegment[]
  exclusiveGroup?: string
  trigger?:
    | { type: 'automatic' }
    | { type: 'code'; code: string }
    | { type: 'personal_offer'; offer: PersonalOfferType }
}

export interface OrderDiscountRule extends BaseRule {
  kind: 'order_discount'
  valueType: 'percentage' | 'fixed_amount'
  value: number
  target:
    | { type: 'all' }
    | { type: 'collections'; collectionIds: string[] }
    | { type: 'products'; productIds: string[] }
  code: string | null
  combinableWith: RuleKind[]
}

export interface ShippingThresholdRule extends BaseRule {
  kind: 'shipping_threshold'
  thresholds: Partial<
    Record<
      MarketCode,
      {
        amount: number
        paidRate: number
        currencyCode: CurrencyCode
        source: string
      }
    >
  >
}

export interface GiftThresholdRule extends BaseRule {
  kind: 'gift_threshold'
  threshold: number
  giftProductId: string
  giftTitle: string
}

export interface GiftWithPurchaseRule extends BaseRule {
  kind: 'gift_with_purchase'
  buyCategory: MarketingProduct['category']
  giftProductId: string
  giftTitle: string
  minQuantity: number
}

export interface AnnouncementRule extends BaseRule {
  kind: 'announcement'
  message: string
}

export interface MarketingExperienceInput {
  now: string
  market: MarketCode
  currencyCode: CurrencyCode
  customerSegment: CustomerSegment
  cart: MarketingCartLine[]
  campaigns: MarketingCampaign[]
  products: MarketingProduct[]
  selectedCodes?: string[]
  selectedPersonalOffers?: PersonalOfferType[]
}

export interface AppliedMarketingRule {
  campaignId: string
  campaignTitle: string
  ruleId: string
  label: string
  kind: RuleKind
  execution: ExecutionChannel[]
  impact: string
}

export interface CartGift {
  productId: string
  title: string
  quantity: number
  sourceRuleId: string
}

export interface ProgressMilestone {
  id: string
  label: string
  amount: number
  reached: boolean
  remaining: number
  kind: 'shipping' | 'gift'
}

export interface MarketingExperienceResult {
  currencyCode: CurrencyCode
  subtotal: number
  discountTotal: number
  estimatedShipping: number
  totalBeforeTax: number
  announcements: string[]
  appliedRules: AppliedMarketingRule[]
  gifts: CartGift[]
  progress: {
    current: number
    next: ProgressMilestone | null
    milestones: ProgressMilestone[]
  }
  shopifyPlan: Array<{
    channel: ExecutionChannel
    action: string
    sourceRuleId: string
  }>
  warnings: string[]
}

export function evaluateMarketingExperience(input: MarketingExperienceInput): MarketingExperienceResult {
  const productsById = new Map(input.products.map((product) => [product.id, product]))
  const now = new Date(input.now)
  const activeRules = input.campaigns
    .filter((campaign) => campaign.status === 'active' && isWithinWindow(now, campaign.startsAt, campaign.endsAt))
    .sort((a, b) => b.priority - a.priority)
    .flatMap((campaign) =>
      campaign.rules
        .filter((rule) =>
          isRuleEligible(
            rule,
            input.market,
            input.customerSegment,
            input.selectedCodes ?? [],
            input.selectedPersonalOffers ?? [],
          ),
        )
        .map((rule) => ({ campaign, rule })),
    )

  const subtotal = input.cart.reduce((sum, line) => {
    const product = productsById.get(line.productId)
    return sum + (product?.price ?? 0) * Math.max(0, line.quantity)
  }, 0)

  const result: MarketingExperienceResult = {
    currencyCode: input.currencyCode,
    subtotal,
    discountTotal: 0,
    estimatedShipping: 0,
    totalBeforeTax: subtotal,
    announcements: [],
    appliedRules: [],
    gifts: [],
    progress: { current: subtotal, next: null, milestones: [] },
    shopifyPlan: [],
    warnings: [],
  }

  let shippingRuleSeen = false
  const exclusiveGroupsSeen = new Set<string>()

  for (const { campaign, rule } of activeRules) {
    if (rule.exclusiveGroup && exclusiveGroupsSeen.has(rule.exclusiveGroup)) continue

    if (rule.kind === 'announcement') {
      result.announcements.push(rule.message)
      appendAppliedRule(result, campaign, rule, 'Annonce visible sur les surfaces marketing.')
      if (rule.exclusiveGroup) exclusiveGroupsSeen.add(rule.exclusiveGroup)
      continue
    }

    if (rule.kind === 'shipping_threshold') {
      if (shippingRuleSeen) continue
      const threshold = rule.thresholds[input.market]
      if (!threshold) {
        result.warnings.push(`${rule.label}: aucun seuil defini pour le market ${input.market}.`)
        continue
      }
      shippingRuleSeen = true
      const reached = subtotal >= threshold.amount
      result.estimatedShipping = reached ? 0 : threshold.paidRate
      result.progress.milestones.push({
        id: rule.id,
        label: 'Livraison offerte',
        amount: threshold.amount,
        reached,
        remaining: Math.max(0, threshold.amount - subtotal),
        kind: 'shipping',
      })
      appendAppliedRule(
        result,
        campaign,
        rule,
        reached
          ? `Livraison estimee offerte via ${threshold.source}.`
          : `Livraison estimee a ${formatMoney(threshold.paidRate, threshold.currencyCode)} via ${threshold.source}.`,
      )
      if (rule.exclusiveGroup) exclusiveGroupsSeen.add(rule.exclusiveGroup)
      continue
    }

    if (rule.kind === 'gift_threshold') {
      const reached = subtotal >= rule.threshold
      result.progress.milestones.push({
        id: rule.id,
        label: rule.giftTitle,
        amount: rule.threshold,
        reached,
        remaining: Math.max(0, rule.threshold - subtotal),
        kind: 'gift',
      })
      if (reached) {
        result.gifts.push({ productId: rule.giftProductId, title: rule.giftTitle, quantity: 1, sourceRuleId: rule.id })
        appendAppliedRule(result, campaign, rule, `${rule.giftTitle} ajoute au panier simule.`)
        if (rule.exclusiveGroup) exclusiveGroupsSeen.add(rule.exclusiveGroup)
      }
      continue
    }

    if (rule.kind === 'gift_with_purchase') {
      const quantity = input.cart.reduce((sum, line) => {
        const product = productsById.get(line.productId)
        return product?.category === rule.buyCategory ? sum + line.quantity : sum
      }, 0)
      if (quantity >= rule.minQuantity) {
        result.gifts.push({ productId: rule.giftProductId, title: rule.giftTitle, quantity: 1, sourceRuleId: rule.id })
        appendAppliedRule(result, campaign, rule, `${rule.giftTitle} ajoute car ${rule.buyCategory} present.`)
        if (rule.exclusiveGroup) exclusiveGroupsSeen.add(rule.exclusiveGroup)
      }
      continue
    }

    if (rule.kind === 'order_discount') {
      const eligibleSubtotal = eligibleSubtotalForDiscount(rule, input.cart, productsById)
      if (eligibleSubtotal <= 0) continue
      const discount =
        rule.valueType === 'percentage' ? eligibleSubtotal * (rule.value / 100) : Math.min(rule.value, eligibleSubtotal)
      result.discountTotal += discount
      appendAppliedRule(result, campaign, rule, `${formatMoney(discount, input.currencyCode)} de remise estimee.`)
      if (rule.exclusiveGroup) exclusiveGroupsSeen.add(rule.exclusiveGroup)
    }
  }

  if (!shippingRuleSeen) result.warnings.push('Aucune regle de livraison active pour ce scenario.')

  result.discountTotal = roundMoney(result.discountTotal)
  result.estimatedShipping = roundMoney(result.estimatedShipping)
  result.totalBeforeTax = roundMoney(Math.max(0, subtotal - result.discountTotal) + result.estimatedShipping)
  result.progress.milestones.sort((a, b) => a.amount - b.amount)
  result.progress.next = result.progress.milestones.find((milestone) => !milestone.reached) ?? null
  result.shopifyPlan = result.appliedRules.flatMap((rule) =>
    rule.execution.map((channel) => ({
      channel,
      action: actionForChannel(channel, rule.kind),
      sourceRuleId: rule.ruleId,
    })),
  )

  return result
}

function appendAppliedRule(
  result: MarketingExperienceResult,
  campaign: MarketingCampaign,
  rule: MarketingRule,
  impact: string,
) {
  result.appliedRules.push({
    campaignId: campaign.id,
    campaignTitle: campaign.title,
    ruleId: rule.id,
    label: rule.label,
    kind: rule.kind,
    execution: rule.execution,
    impact,
  })
}

function isWithinWindow(now: Date, startsAt: string, endsAt: string | null): boolean {
  const start = new Date(startsAt)
  if (Number.isNaN(start.getTime()) || now < start) return false
  if (!endsAt) return true
  const end = new Date(endsAt)
  return !Number.isNaN(end.getTime()) && now <= end
}

function isRuleEligible(
  rule: MarketingRule,
  market: MarketCode,
  customerSegment: CustomerSegment,
  selectedCodes: string[],
  selectedPersonalOffers: PersonalOfferType[],
): boolean {
  if (!rule.enabled) return false
  if (rule.markets && !rule.markets.includes(market)) return false
  if (rule.customerSegments && !rule.customerSegments.includes(customerSegment)) return false
  if (rule.trigger?.type === 'code' && !selectedCodes.includes(rule.trigger.code)) return false
  if (rule.trigger?.type === 'personal_offer' && !selectedPersonalOffers.includes(rule.trigger.offer)) return false
  return true
}

function eligibleSubtotalForDiscount(
  rule: OrderDiscountRule,
  cart: MarketingCartLine[],
  productsById: Map<string, MarketingProduct>,
): number {
  if (rule.target.type === 'all') {
    return cart.reduce((sum, line) => sum + (productsById.get(line.productId)?.price ?? 0) * line.quantity, 0)
  }

  if (rule.target.type === 'products') {
    const ids = new Set(rule.target.productIds)
    return cart.reduce((sum, line) => {
      if (!ids.has(line.productId)) return sum
      return sum + (productsById.get(line.productId)?.price ?? 0) * line.quantity
    }, 0)
  }

  const collectionIds = new Set(rule.target.collectionIds)
  return cart.reduce((sum, line) => {
    const product = productsById.get(line.productId)
    if (!product?.collectionIds.some((id) => collectionIds.has(id))) return sum
    return sum + product.price * line.quantity
  }, 0)
}

function actionForChannel(channel: ExecutionChannel, kind: RuleKind): string {
  if (channel === 'shopify_discount') return 'Synchroniser un discount Shopify compatible.'
  if (channel === 'shipping_profile') return 'Synchroniser le profil de livraison par market.'
  if (channel === 'cart_transform') return 'Appliquer la mutation panier via notre cart engine.'
  if (channel === 'theme_surface') return 'Exposer la regle aux surfaces theme: announcement, drawer, progress.'
  if (channel === 'email_copy') return 'Rendre disponible pour les relances emails et messages CRM.'
  return `Executer ${kind}.`
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function formatMoney(value: number, currencyCode: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currencyCode }).format(value)
}
