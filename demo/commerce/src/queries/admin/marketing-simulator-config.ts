import { desc, isNull } from 'drizzle-orm'
import { ShopifyAdminClient } from '../../modules/shopify-admin/client'
import { resolveTable } from '../../utils/drizzle-read'

interface MoneyNode {
  amount: string
  currencyCode: string
}

interface MarketCountryNode {
  id: string
  name: string
  code: string
  currency: {
    currencyCode: string
    currencyName: string
    enabled: boolean
  }
}

interface MarketNode {
  id: string
  name: string
  handle: string
  status: string
  currencySettings: {
    baseCurrency: {
      currencyCode: string
      currencyName: string
      enabled: boolean
    }
    localCurrencies: boolean
  } | null
  conditions: {
    regionsCondition: {
      regions: { nodes: MarketCountryNode[] }
    } | null
  } | null
}

interface DeliveryCountryNode {
  name: string
  code: {
    countryCode: string | null
    restOfWorld: boolean
  }
}

interface DeliveryMethodNode {
  id: string
  name: string
  active: boolean
  methodConditions: Array<{
    field: string
    operator: string
    conditionCriteria: ({ __typename: 'MoneyV2' } & MoneyNode) | { __typename: string }
  }>
  rateProvider: ({ __typename: 'DeliveryRateDefinition'; price: MoneyNode } | { __typename: string }) | null
}

interface DeliveryProfileNode {
  id: string
  name: string
  default: boolean
  profileLocationGroups: Array<{
    locationGroupZones: {
      nodes: Array<{
        zone: {
          id: string
          name: string
          countries: DeliveryCountryNode[]
        }
        methodDefinitions: {
          nodes: DeliveryMethodNode[]
        }
      }>
    }
  }>
}

interface ShopifyDiscountNode {
  id: string
  discount: {
    __typename: string
    title?: string | null
    status?: string | null
    startsAt?: string | null
    endsAt?: string | null
    summary?: string | null
    shortSummary?: string | null
    customerGets?: {
      value?:
        | { __typename: 'DiscountPercentage'; percentage: number }
        | { __typename: 'DiscountAmount'; amount: MoneyNode; appliesOnEachItem?: boolean | null }
        | { __typename: string }
    } | null
    codes?: { nodes?: Array<{ code: string }> } | null
    codesCount?: { count: number } | null
    appliesOncePerCustomer?: boolean | null
    usageLimit?: number | null
    customerSelection?: {
      __typename: string
      allCustomers?: boolean | null
    } | null
  }
}

type DiscountValueNode = NonNullable<NonNullable<ShopifyDiscountNode['discount']['customerGets']>['value']>

interface ProductVariantNode {
  id: string
  title: string
  price: string
  product: {
    id: string
    title: string
    handle: string
    productType: string | null
    collections: {
      nodes: Array<{ id: string; handle: string }>
    }
  }
  contextualPricing: {
    price: MoneyNode
    compareAtPrice: MoneyNode | null
  } | null
}

interface NormalizedMarket {
  key: string
  id: string
  name: string
  handle: string
  status: string
  currency_code: string
  currency_name: string
  countries: Array<{ code: string; name: string; currency_code: string }>
}

interface NormalizedShopifyDiscount {
  id: string
  title: string
  type: string
  status: string
  starts_at: string | null
  ends_at: string | null
  summary: string
  value_type: 'percentage' | 'fixed_amount' | 'unsupported'
  value: number
  currency_code: string | null
  code: string | null
  usage_limit: number | null
  applies_once_per_customer: boolean
  codes_count: number | null
  customer_selection: {
    type: string
    all_customers: boolean
  } | null
  source: 'shopify'
}

interface ShippingThreshold {
  market_key: string
  market_name: string
  currency_code: string
  threshold: number
  paid_rate: number
  zone_name: string
  method_name: string
  free_method_id: string
  paid_method_id: string | null
  source: string
}

interface NormalizedProduct {
  id: string
  title: string
  price: number
  currency_code: string
  category: 'jewelry' | 'charm' | 'accessory'
  collectionIds: string[]
  market_key: string
  context_country: string | null
  source: 'shopify'
}

interface NormalizedPalasRule {
  id: string
  title: string
  rule_type: 'order_discount' | 'first_order_discount' | 'gift_threshold' | 'shipping_threshold'
  status: 'draft' | 'active' | 'paused'
  starts_at: string
  ends_at: string | null
  execution_kind: 'shopify_discount' | 'local_cart_rule' | 'shipping_profile'
  sync_status: 'local_only' | 'synced' | 'pending' | 'error'
  shopify_id: string | null
  sync_error: string | null
  market_key: string | null
  currency_code: string | null
  value_type: 'percentage' | 'fixed_amount' | null
  value: number | null
  code: string | null
  threshold: number | null
  gift_product_id: string | null
  gift_title: string | null
  paid_rate: number | null
  payload: Record<string, unknown> | null
  source: 'palas'
}

export default defineQuery({
  name: 'marketing-simulator-config',
  description: 'Live Shopify markets and delivery thresholds for the Palas marketing simulator.',
  input: z.object({}),
  handler: async (_input, { db, schema }) => {
    const client = new ShopifyAdminClient()
    const [marketsData, deliveryData, discountData, palasRules] = await Promise.all([
      client.query<{
        shop: { currencyCode: string }
        markets: { nodes: MarketNode[] }
      }>(MARKETS_QUERY),
      client.query<{
        deliveryProfiles: { nodes: DeliveryProfileNode[] }
      }>(DELIVERY_QUERY),
      client.query<{
        discountNodes: { nodes: ShopifyDiscountNode[] }
      }>(DISCOUNTS_QUERY),
      readPalasRules(db, schema),
    ])

    const markets = marketsData.markets.nodes.filter((market) => market.status === 'ACTIVE').map(normalizeMarket)
    const products = await readMarketProducts(client, markets, marketsData.shop.currencyCode)
    const shippingThresholds = normalizeShippingThresholds(markets, deliveryData.deliveryProfiles.nodes)
    const shopifyDiscounts = discountData.discountNodes.nodes.map(normalizeShopifyDiscount).filter(Boolean)

    return {
      meta: {
        generated_at: new Date().toISOString(),
        shop_currency_code: marketsData.shop.currencyCode,
      },
      markets,
      shipping_thresholds: shippingThresholds,
      shopify_discounts: shopifyDiscounts,
      palas_rules: palasRules,
      products,
    }
  },
})

async function readMarketProducts(
  client: ShopifyAdminClient,
  markets: NormalizedMarket[],
  fallbackCurrencyCode: string,
): Promise<NormalizedProduct[]> {
  const results = await Promise.all(
    markets.map(async (market) => {
      const countryCode = market.countries[0]?.code ?? 'FR'
      try {
        const data = await client.query<{
          productVariants: { nodes: ProductVariantNode[] }
        }>(PRODUCT_VARIANTS_QUERY, { country: countryCode })
        return data.productVariants.nodes.map((variant) =>
          normalizeProductVariant(variant, market, fallbackCurrencyCode),
        )
      } catch {
        return []
      }
    }),
  )
  return results.flat()
}

function normalizeProductVariant(
  variant: ProductVariantNode,
  market: NormalizedMarket,
  fallbackCurrencyCode: string,
): NormalizedProduct {
  const contextualPrice = variant.contextualPricing?.price
  const price = Number(contextualPrice?.amount ?? variant.price)
  const collections = variant.product.collections.nodes.map((collection) => collection.handle || collection.id)
  const title =
    variant.title === 'Default Title' ? variant.product.title : `${variant.product.title} · ${variant.title}`
  return {
    id: variant.id,
    title,
    price: Number.isFinite(price) ? price : 0,
    currency_code: contextualPrice?.currencyCode ?? market.currency_code ?? fallbackCurrencyCode,
    category: inferProductCategory(variant.product.title, variant.product.productType, collections),
    collectionIds: collections,
    market_key: market.key,
    context_country: market.countries[0]?.code ?? null,
    source: 'shopify',
  }
}

function inferProductCategory(
  title: string,
  productType: string | null,
  collectionIds: string[],
): NormalizedProduct['category'] {
  const haystack = [title, productType ?? '', ...collectionIds].join(' ').toLowerCase()
  if (haystack.includes('charm')) return 'charm'
  if (haystack.includes('tote') || haystack.includes('accessor')) return 'accessory'
  return 'jewelry'
}

async function readPalasRules(db: unknown, schema: unknown): Promise<NormalizedPalasRule[]> {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: Mantajs beta exposes Drizzle dynamically in app code.
    const database = db as any
    // biome-ignore lint/suspicious/noExplicitAny: dynamic schema lookup is required before generated types catch up.
    const table = resolveTable(schema as Record<string, unknown>, 'marketingRule') as any
    const rows = await database
      .select()
      .from(table)
      .where(isNull(table.deleted_at))
      .orderBy(desc(table.created_at))
      .limit(500)
    return rows.map((row: unknown) => normalizePalasRule(row as Record<string, unknown>))
  } catch {
    return []
  }
}

function normalizePalasRule(row: Record<string, unknown>): NormalizedPalasRule {
  return {
    id: String(row.id),
    title: String(row.title ?? 'Regle Palas'),
    rule_type: readEnum(
      row.rule_type,
      ['order_discount', 'first_order_discount', 'gift_threshold', 'shipping_threshold'],
      'gift_threshold',
    ),
    status: readEnum(row.status, ['draft', 'active', 'paused'], 'active'),
    starts_at: toIsoString(row.starts_at) ?? new Date().toISOString(),
    ends_at: toIsoString(row.ends_at),
    execution_kind: readEnum(
      row.execution_kind,
      ['shopify_discount', 'local_cart_rule', 'shipping_profile'],
      'local_cart_rule',
    ),
    sync_status: readEnum(row.sync_status, ['local_only', 'synced', 'pending', 'error'], 'local_only'),
    shopify_id: nullableString(row.shopify_id),
    sync_error: nullableString(row.sync_error),
    market_key: nullableString(row.market_key),
    currency_code: nullableString(row.currency_code),
    value_type: readNullableEnum(row.value_type, ['percentage', 'fixed_amount']),
    value: nullableNumber(row.value),
    code: nullableString(row.code),
    threshold: nullableNumber(row.threshold),
    gift_product_id: nullableString(row.gift_product_id),
    gift_title: nullableString(row.gift_title),
    paid_rate: nullableNumber(row.paid_rate),
    payload: typeof row.payload === 'object' && row.payload !== null ? (row.payload as Record<string, unknown>) : null,
    source: 'palas',
  }
}

function normalizeShopifyDiscount(node: ShopifyDiscountNode): NormalizedShopifyDiscount | null {
  const discount = node.discount
  if (!['DiscountCodeBasic', 'DiscountAutomaticBasic'].includes(discount.__typename)) return null

  const value = discount.customerGets?.value
  const normalizedValue = isDiscountPercentage(value)
    ? { value_type: 'percentage' as const, value: value.percentage * 100, currency_code: null }
    : isDiscountAmount(value)
      ? {
          value_type: 'fixed_amount' as const,
          value: Number(value.amount.amount),
          currency_code: value.amount.currencyCode,
        }
      : { value_type: 'unsupported' as const, value: 0, currency_code: null }

  if (normalizedValue.value_type === 'unsupported') return null

  return {
    id: node.id,
    title: discount.title ?? '(Discount Shopify sans titre)',
    type: discount.__typename,
    status: discount.status ?? 'UNKNOWN',
    starts_at: discount.startsAt ?? null,
    ends_at: discount.endsAt ?? null,
    summary: discount.shortSummary ?? discount.summary ?? '',
    value_type: normalizedValue.value_type,
    value: normalizedValue.value,
    currency_code: normalizedValue.currency_code,
    code: discount.codes?.nodes?.[0]?.code ?? null,
    usage_limit: discount.usageLimit ?? null,
    applies_once_per_customer: Boolean(discount.appliesOncePerCustomer),
    codes_count: discount.codesCount?.count ?? (discount.codes?.nodes?.length ? discount.codes.nodes.length : null),
    customer_selection: discount.customerSelection
      ? {
          type: discount.customerSelection.__typename,
          all_customers:
            discount.customerSelection.__typename === 'DiscountCustomerAll'
              ? discount.customerSelection.allCustomers !== false
              : false,
        }
      : null,
    source: 'shopify',
  }
}

function readEnum<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback
}

function readNullableEnum<T extends string>(value: unknown, values: readonly T[]): T | null {
  return values.includes(value as T) ? (value as T) : null
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function toIsoString(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function isDiscountPercentage(value: DiscountValueNode | undefined): value is {
  __typename: 'DiscountPercentage'
  percentage: number
} {
  return value?.__typename === 'DiscountPercentage'
}

function isDiscountAmount(value: DiscountValueNode | undefined): value is {
  __typename: 'DiscountAmount'
  amount: MoneyNode
  appliesOnEachItem?: boolean | null
} {
  return value?.__typename === 'DiscountAmount'
}

function normalizeMarket(market: MarketNode): NormalizedMarket {
  const countries =
    market.conditions?.regionsCondition?.regions.nodes.map((country) => ({
      code: country.code,
      name: country.name,
      currency_code: country.currency.currencyCode,
    })) ?? []
  const baseCurrency = market.currencySettings?.baseCurrency
  const firstCountryCurrency = countries.find((country) => country.currency_code)?.currency_code
  return {
    key: market.handle || market.id,
    id: market.id,
    name: market.name,
    handle: market.handle,
    status: market.status,
    currency_code: baseCurrency?.currencyCode ?? firstCountryCurrency ?? 'EUR',
    currency_name: baseCurrency?.currencyName ?? baseCurrency?.currencyCode ?? firstCountryCurrency ?? 'EUR',
    countries,
  }
}

function normalizeShippingThresholds(
  markets: NormalizedMarket[],
  profiles: DeliveryProfileNode[],
): ShippingThreshold[] {
  const zones = profiles.flatMap((profile) =>
    profile.profileLocationGroups.flatMap((group) =>
      group.locationGroupZones.nodes.map((node) => ({
        profile,
        zone: node.zone,
        methods: node.methodDefinitions.nodes.filter((method) => method.active),
      })),
    ),
  )

  return markets
    .map((market) => {
      const countryCodes = new Set(market.countries.map((country) => country.code))
      const matchingZones = zones.filter((zone) =>
        zone.zone.countries.some((country) => {
          if (country.code.restOfWorld && countryCodes.size === 0) return true
          return country.code.countryCode ? countryCodes.has(country.code.countryCode) : false
        }),
      )

      const threshold = matchingZones
        .flatMap((zone) => extractZoneThresholds(market, zone.profile, zone.zone, zone.methods))
        .sort((a, b) => a.threshold - b.threshold)[0]

      return threshold ?? null
    })
    .filter((threshold): threshold is ShippingThreshold => Boolean(threshold))
}

function extractZoneThresholds(
  market: NormalizedMarket,
  profile: DeliveryProfileNode,
  zone: { id: string; name: string; countries: DeliveryCountryNode[] },
  methods: DeliveryMethodNode[],
): ShippingThreshold[] {
  return methods
    .filter((method) => readRatePrice(method)?.amount === 0)
    .map((freeMethod) => {
      const freePrice = readRatePrice(freeMethod)
      const threshold = readMinimumSubtotal(freeMethod)
      if (!freePrice || threshold === null) return null
      const paidMethod = findPaidMethodForThreshold(methods, threshold, freePrice.currencyCode)
      const paidRate = paidMethod ? (readRatePrice(paidMethod)?.amount ?? 0) : 0
      return {
        market_key: market.key,
        market_name: market.name,
        currency_code: freePrice.currencyCode,
        threshold,
        paid_rate: paidRate,
        zone_name: zone.name,
        method_name: freeMethod.name,
        free_method_id: freeMethod.id,
        paid_method_id: paidMethod?.id ?? null,
        source: `${profile.name} / ${zone.name}`,
      }
    })
    .filter((threshold): threshold is ShippingThreshold => Boolean(threshold))
}

function findPaidMethodForThreshold(
  methods: DeliveryMethodNode[],
  threshold: number,
  currencyCode: string,
): DeliveryMethodNode | null {
  return (
    methods.find((method) => {
      const price = readRatePrice(method)
      if (!price || price.currencyCode !== currencyCode || price.amount <= 0) return false
      const max = readMaximumSubtotal(method)
      return max === null || max < threshold || Math.abs(max - 0.01 - threshold) < 1
    }) ?? null
  )
}

function readRatePrice(method: DeliveryMethodNode): { amount: number; currencyCode: string } | null {
  if (!isDeliveryRateDefinition(method.rateProvider)) return null
  return {
    amount: Number(method.rateProvider.price.amount),
    currencyCode: method.rateProvider.price.currencyCode,
  }
}

function readMinimumSubtotal(method: DeliveryMethodNode): number | null {
  return readMoneyCondition(method, 'TOTAL_PRICE', 'GREATER_THAN_OR_EQUAL_TO')
}

function readMaximumSubtotal(method: DeliveryMethodNode): number | null {
  return readMoneyCondition(method, 'TOTAL_PRICE', 'LESS_THAN_OR_EQUAL_TO')
}

function readMoneyCondition(method: DeliveryMethodNode, field: string, operator: string): number | null {
  const condition = method.methodConditions.find(
    (condition) =>
      condition.field === field &&
      condition.operator === operator &&
      condition.conditionCriteria.__typename === 'MoneyV2',
  )
  if (!isMoneyV2(condition?.conditionCriteria)) return null
  const amount = Number(condition.conditionCriteria.amount)
  return Number.isFinite(amount) ? amount : null
}

function isDeliveryRateDefinition(
  value: DeliveryMethodNode['rateProvider'],
): value is { __typename: 'DeliveryRateDefinition'; price: MoneyNode } {
  return value?.__typename === 'DeliveryRateDefinition'
}

function isMoneyV2(
  value: DeliveryMethodNode['methodConditions'][number]['conditionCriteria'] | undefined,
): value is { __typename: 'MoneyV2' } & MoneyNode {
  return value?.__typename === 'MoneyV2'
}

const MARKETS_QUERY = `
  query PalasMarketingSimulatorMarkets {
    shop { currencyCode }
    markets(first: 50) {
      nodes {
        id
        name
        handle
        status
        currencySettings {
          baseCurrency { currencyCode currencyName enabled }
          localCurrencies
        }
        conditions {
          regionsCondition {
            regions(first: 250) {
              nodes {
                id
                name
                ... on MarketRegionCountry {
                  code
                  currency { currencyCode currencyName enabled }
                }
              }
            }
          }
        }
      }
    }
  }
`

const DELIVERY_QUERY = `
  query PalasMarketingSimulatorDelivery {
    deliveryProfiles(first: 5, merchantOwnedOnly: true) {
      nodes {
        id
        name
        default
        profileLocationGroups {
          locationGroupZones(first: 30) {
            nodes {
              zone {
                id
                name
                countries {
                  name
                  code { countryCode restOfWorld }
                }
              }
              methodDefinitions(first: 30) {
                nodes {
                  id
                  name
                  active
                  methodConditions {
                    field
                    operator
                    conditionCriteria {
                      __typename
                      ... on MoneyV2 { amount currencyCode }
                    }
                  }
                  rateProvider {
                    __typename
                    ... on DeliveryRateDefinition {
                      price { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`

const DISCOUNTS_QUERY = `
  query PalasMarketingSimulatorDiscounts {
    discountNodes(first: 100, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        discount {
          __typename
          ... on DiscountCodeBasic {
            title
            status
            startsAt
            endsAt
            summary
            shortSummary
            codes(first: 1) { nodes { code } }
            codesCount { count }
            appliesOncePerCustomer
            usageLimit
            customerSelection {
              __typename
              ... on DiscountCustomerAll { allCustomers }
            }
            customerGets {
              value {
                __typename
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
              }
            }
          }
          ... on DiscountAutomaticBasic {
            title
            status
            startsAt
            endsAt
            summary
            shortSummary
            customerGets {
              value {
                __typename
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
              }
            }
          }
        }
      }
    }
  }
`

const PRODUCT_VARIANTS_QUERY = `
  query PalasMarketingSimulatorProducts($country: CountryCode!) {
    productVariants(first: 250, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        price
        contextualPricing(context: { country: $country }) {
          price { amount currencyCode }
          compareAtPrice { amount currencyCode }
        }
        product {
          id
          title
          handle
          productType
          collections(first: 10) {
            nodes { id handle }
          }
        }
      }
    }
  }
`
