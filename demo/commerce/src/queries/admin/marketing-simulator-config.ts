import { ShopifyAdminClient } from '../../modules/shopify-admin/client'

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

export default defineQuery({
  name: 'marketing-simulator-config',
  description: 'Live Shopify markets and delivery thresholds for the Palas marketing simulator.',
  input: z.object({}),
  handler: async () => {
    const client = new ShopifyAdminClient()
    const [marketsData, deliveryData] = await Promise.all([
      client.query<{
        shop: { currencyCode: string }
        markets: { nodes: MarketNode[] }
      }>(MARKETS_QUERY),
      client.query<{
        deliveryProfiles: { nodes: DeliveryProfileNode[] }
      }>(DELIVERY_QUERY),
    ])

    const markets = marketsData.markets.nodes.filter((market) => market.status === 'ACTIVE').map(normalizeMarket)
    const shippingThresholds = normalizeShippingThresholds(markets, deliveryData.deliveryProfiles.nodes)

    return {
      meta: {
        generated_at: new Date().toISOString(),
        shop_currency_code: marketsData.shop.currencyCode,
      },
      markets,
      shipping_thresholds: shippingThresholds,
    }
  },
})

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
