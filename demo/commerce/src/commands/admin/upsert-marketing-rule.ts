import { ShopifyAdminClient } from '../../modules/shopify-admin/client'

type MarketingRuleType = 'order_discount' | 'first_order_discount' | 'gift_threshold' | 'shipping_threshold'
type ExecutionKind = 'shopify_discount' | 'local_cart_rule' | 'shipping_profile'
type SyncStatus = 'local_only' | 'synced' | 'pending' | 'error'

interface MoneyNode {
  amount: string
  currencyCode: string
}

interface MarketNode {
  id: string
  name: string
  handle: string
  status: string
  conditions: {
    regionsCondition: {
      regions: {
        nodes: Array<{
          code: string
          name: string
        }>
      }
    } | null
  } | null
}

interface DeliveryMethodNode {
  id: string
  name: string
  active: boolean
  methodConditions: Array<{
    id: string
    field: string
    operator: string
    conditionCriteria: ({ __typename: 'MoneyV2' } & MoneyNode) | { __typename: string }
  }>
  rateProvider: ({ __typename: 'DeliveryRateDefinition'; price: MoneyNode } | { __typename: string }) | null
}

interface DeliveryProfileNode {
  id: string
  name: string
  profileLocationGroups: Array<{
    locationGroup: { id: string }
    locationGroupZones: {
      nodes: Array<{
        zone: {
          id: string
          name: string
          countries: Array<{
            code: {
              countryCode: string | null
              restOfWorld: boolean
            }
          }>
        }
        methodDefinitions: {
          nodes: DeliveryMethodNode[]
        }
      }>
    }
  }>
}

interface MarketingRuleRow {
  id: string
  shopify_id?: string | null
  payload?: Record<string, unknown> | null
}

interface EntityCrud<Row> {
  create: (data: Record<string, unknown>) => Promise<Row>
  update: (id: string, data: Record<string, unknown>) => Promise<Row>
  list: (filters: Record<string, unknown>, options?: Record<string, unknown>) => Promise<Row[]>
}

interface MarketingRuleInput {
  id?: string
  title: string
  rule_type: MarketingRuleType
  status: 'draft' | 'active' | 'paused'
  starts_at: string
  ends_at?: string | null
  market_key?: string | null
  currency_code?: string | null
  value_type?: 'percentage' | 'fixed_amount' | null
  value?: number | null
  code?: string | null
  threshold?: number | null
  gift_product_id?: string | null
  gift_title?: string | null
  paid_rate?: number | null
  personal_offer?: 'welcome' | 'abandoned_cart' | 'birthday' | null
}

const inputSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().trim().min(1),
  rule_type: z.enum(['order_discount', 'first_order_discount', 'gift_threshold', 'shipping_threshold']),
  status: z.enum(['draft', 'active', 'paused']).default('active'),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime().nullable().optional(),
  market_key: z.string().nullable().optional(),
  currency_code: z.string().nullable().optional(),
  value_type: z.enum(['percentage', 'fixed_amount']).nullable().optional(),
  value: z.number().positive().nullable().optional(),
  code: z.string().trim().nullable().optional(),
  threshold: z.number().min(0).nullable().optional(),
  gift_product_id: z.string().trim().nullable().optional(),
  gift_title: z.string().trim().nullable().optional(),
  paid_rate: z.number().min(0).nullable().optional(),
  personal_offer: z.enum(['welcome', 'abandoned_cart', 'birthday']).nullable().optional(),
})

export default defineCommand({
  name: 'upsertMarketingRule',
  description: 'Create or update a Palas marketing rule and route it to Shopify/local execution.',
  input: inputSchema,
  workflow: async (input, { step, log }) => {
    validateMarketingRule(input)
    const executionKind = executionKindFor(input.rule_type)
    const svc = step.service as unknown as { marketingRule: EntityCrud<MarketingRuleRow> }
    const existing = input.id ? (await svc.marketingRule.list({ id: input.id }, { take: 1 }))[0] : null
    const existingShopifyId = existing?.shopify_id ?? null
    let shopifyId: string | null = existingShopifyId
    let syncStatus: SyncStatus = executionKind === 'local_cart_rule' || input.status !== 'active' ? 'local_only' : 'pending'
    let syncError: string | null = null

    if (executionKind === 'shopify_discount' && input.status === 'active') {
      try {
        const commands = step.command as unknown as {
          upsertShopifyDiscount: (input: Record<string, unknown>) => Promise<{ id?: string }>
        }
        const result = await commands.upsertShopifyDiscount({
          id: existingShopifyId ?? undefined,
          method: input.code ? 'code' : 'automatic',
          title: input.title,
          code: input.code ?? undefined,
          value_type: input.value_type === 'fixed_amount' ? 'amount' : 'percentage',
          value: input.value ?? 0,
          target_type: 'all',
          collection_ids: [],
          product_ids: [],
          starts_at: input.starts_at,
          ends_at: input.ends_at ?? null,
          applies_once_per_customer: false,
          usage_limit: null,
          combines_with_order: false,
          combines_with_product: false,
          combines_with_shipping: true,
        })
        shopifyId = result.id ?? null
        syncStatus = shopifyId ? 'synced' : 'pending'
      } catch (err) {
        syncStatus = 'error'
        syncError = (err as Error).message
        log.warn(`[upsertMarketingRule] Shopify sync failed: ${syncError}`)
      }
    }

    if (executionKind === 'shipping_profile' && input.status === 'active') {
      try {
        const result = await syncShopifyShippingThreshold(input)
        shopifyId = result.shopifyId
        syncStatus = 'synced'
      } catch (err) {
        syncStatus = 'error'
        syncError = (err as Error).message
        log.warn(`[upsertMarketingRule] Shopify shipping sync failed: ${syncError}`)
      }
    }

    const data = {
      title: input.title,
      rule_type: input.rule_type,
      status: input.status,
      starts_at: new Date(input.starts_at),
      ends_at: input.ends_at ? new Date(input.ends_at) : null,
      execution_kind: executionKind,
      sync_status: syncStatus,
      shopify_id: shopifyId,
      sync_error: syncError,
      market_key: input.market_key ?? null,
      currency_code: input.currency_code ?? null,
      value_type: input.value_type ?? null,
      value: input.value ?? null,
      code: input.code || null,
      threshold: input.threshold ?? null,
      gift_product_id: input.gift_product_id || null,
      gift_title: input.gift_title || null,
      paid_rate: input.paid_rate ?? null,
      payload: buildPayload(existing?.payload, input.personal_offer),
    }

    const row = input.id ? await svc.marketingRule.update(input.id, data) : await svc.marketingRule.create(data)
    await step.emit('marketing-rule.upserted', {
      id: row.id,
      rule_type: input.rule_type,
      execution_kind: executionKind,
      sync_status: syncStatus,
      shopify_id: shopifyId,
    })
    return row
  },
})

function buildPayload(
  existingPayload: Record<string, unknown> | null | undefined,
  personalOffer: MarketingRuleInput['personal_offer'],
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...(existingPayload ?? {}), source: 'palas_admin' }
  if (personalOffer) payload.personal_offer = personalOffer
  if (!personalOffer && 'personal_offer' in payload) delete payload.personal_offer
  return payload
}

function executionKindFor(ruleType: MarketingRuleType): ExecutionKind {
  if (ruleType === 'order_discount') return 'shopify_discount'
  if (ruleType === 'shipping_threshold') return 'shipping_profile'
  return 'local_cart_rule'
}

function validateMarketingRule(input: MarketingRuleInput) {
  if (input.rule_type === 'order_discount' || input.rule_type === 'first_order_discount') {
    if (!input.value_type || !input.value) {
      throw new MantaError('INVALID_DATA', 'Une remise doit avoir un type et une valeur.')
    }
  }
  if (input.rule_type === 'gift_threshold') {
    if (input.threshold == null || !input.gift_title) {
      throw new MantaError('INVALID_DATA', 'Un cadeau doit avoir un seuil et un cadeau.')
    }
  }
  if (input.rule_type === 'shipping_threshold') {
    if (!input.market_key || !input.currency_code || input.threshold == null || input.paid_rate == null) {
      throw new MantaError(
        'INVALID_DATA',
        'Une regle livraison doit avoir un market, une devise, un seuil et un tarif.',
      )
    }
  }
}

async function syncShopifyShippingThreshold(input: MarketingRuleInput): Promise<{ shopifyId: string }> {
  if (!input.market_key || !input.currency_code || input.threshold == null || input.paid_rate == null) {
    throw new MantaError('INVALID_DATA', 'Shipping rule incomplete.')
  }

  const client = new ShopifyAdminClient()
  const [marketsData, deliveryData] = await Promise.all([
    client.query<{ markets: { nodes: MarketNode[] } }>(SHIPPING_MARKETS_QUERY),
    client.query<{ deliveryProfiles: { nodes: DeliveryProfileNode[] } }>(SHIPPING_DELIVERY_QUERY),
  ])
  const market = findMarket(marketsData.markets.nodes, input.market_key)
  if (!market) throw new MantaError('NOT_FOUND', `Market Shopify introuvable: ${input.market_key}`)
  const zoneMatch = findShippingZoneForMarket(deliveryData.deliveryProfiles.nodes, market)
  if (!zoneMatch) throw new MantaError('NOT_FOUND', `Zone livraison introuvable pour ${market.name}.`)

  const freeMethod = findFreeShippingMethod(zoneMatch.methods, input.currency_code)
  if (!freeMethod) throw new MantaError('NOT_FOUND', `Methode livraison gratuite introuvable pour ${market.name}.`)
  const paidMethod = findPaidShippingMethod(zoneMatch.methods, input.currency_code, input.threshold)

  const methodDefinitionsToUpdate: Array<Record<string, unknown>> = [
    buildFreeShippingMethodUpdate(freeMethod, input.threshold, input.currency_code),
  ]
  if (paidMethod) {
    methodDefinitionsToUpdate.push(buildPaidShippingMethodUpdate(paidMethod, input.paid_rate, input.currency_code))
  }

  const data = await client.query<{
    deliveryProfileUpdate: {
      profile: { id: string } | null
      userErrors: Array<{ field?: string[] | null; message: string }>
    }
  }>(SHIPPING_UPDATE_MUTATION, {
    id: zoneMatch.profileId,
    profile: {
      locationGroupsToUpdate: [
        {
          id: zoneMatch.locationGroupId,
          zonesToUpdate: [
            {
              id: zoneMatch.zoneId,
              methodDefinitionsToUpdate,
            },
          ],
        },
      ],
    },
  })

  const errors = data.deliveryProfileUpdate.userErrors
  if (errors.length > 0) {
    throw new MantaError('UNEXPECTED_STATE', errors.map((error) => error.message).join(' | '))
  }
  if (!data.deliveryProfileUpdate.profile) {
    throw new MantaError('UNEXPECTED_STATE', 'Shopify a retourne un profile vide apres update livraison.')
  }

  return { shopifyId: `${zoneMatch.profileId}|${zoneMatch.zoneId}|${freeMethod.id}` }
}

function findMarket(markets: MarketNode[], key: string): MarketNode | null {
  return markets.find((market) => market.status === 'ACTIVE' && (market.handle === key || market.id === key)) ?? null
}

function findShippingZoneForMarket(profiles: DeliveryProfileNode[], market: MarketNode) {
  const countryCodes = new Set(market.conditions?.regionsCondition?.regions.nodes.map((country) => country.code) ?? [])
  for (const profile of profiles) {
    for (const group of profile.profileLocationGroups) {
      for (const zoneNode of group.locationGroupZones.nodes) {
        const matchesZone = zoneNode.zone.countries.some((country) => {
          if (country.code.restOfWorld && countryCodes.size === 0) return true
          return country.code.countryCode ? countryCodes.has(country.code.countryCode) : false
        })
        if (matchesZone) {
          return {
            profileId: profile.id,
            locationGroupId: group.locationGroup.id,
            zoneId: zoneNode.zone.id,
            methods: zoneNode.methodDefinitions.nodes.filter((method) => method.active),
          }
        }
      }
    }
  }
  return null
}

function findFreeShippingMethod(methods: DeliveryMethodNode[], currencyCode: string): DeliveryMethodNode | null {
  return (
    methods.find((method) => {
      const price = readRatePrice(method)
      return price?.currencyCode === currencyCode && price.amount === 0
    }) ?? null
  )
}

function findPaidShippingMethod(
  methods: DeliveryMethodNode[],
  currencyCode: string,
  threshold: number,
): DeliveryMethodNode | null {
  return (
    methods.find((method) => {
      const price = readRatePrice(method)
      if (!price || price.currencyCode !== currencyCode || price.amount <= 0) return false
      const max = readMoneyCondition(method, 'TOTAL_PRICE', 'LESS_THAN_OR_EQUAL_TO')
      return max === null || max <= threshold || Math.abs(max - 0.01 - threshold) < 1
    }) ?? null
  )
}

function buildFreeShippingMethodUpdate(method: DeliveryMethodNode, threshold: number, currencyCode: string) {
  const minCondition = method.methodConditions.find(
    (condition) =>
      condition.field === 'TOTAL_PRICE' &&
      condition.operator === 'GREATER_THAN_OR_EQUAL_TO' &&
      condition.conditionCriteria.__typename === 'MoneyV2',
  )
  return {
    id: method.id,
    name: method.name,
    active: true,
    rateDefinition: { price: { amount: '0', currencyCode } },
    ...(minCondition
      ? {
          conditionsToUpdate: [
            {
              id: minCondition.id,
              field: 'TOTAL_PRICE',
              operator: 'GREATER_THAN_OR_EQUAL_TO',
              criteria: threshold,
              criteriaUnit: currencyCode,
            },
          ],
        }
      : {
          priceConditionsToCreate: [
            {
              operator: 'GREATER_THAN_OR_EQUAL_TO',
              criteria: { amount: String(threshold), currencyCode },
            },
          ],
        }),
  }
}

function buildPaidShippingMethodUpdate(method: DeliveryMethodNode, paidRate: number, currencyCode: string) {
  return {
    id: method.id,
    name: method.name,
    active: true,
    rateDefinition: { price: { amount: String(paidRate), currencyCode } },
  }
}

function readRatePrice(method: DeliveryMethodNode): { amount: number; currencyCode: string } | null {
  if (!isDeliveryRateDefinition(method.rateProvider)) return null
  return {
    amount: Number(method.rateProvider.price.amount),
    currencyCode: method.rateProvider.price.currencyCode,
  }
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

const SHIPPING_MARKETS_QUERY = `
  query PalasShippingRuleMarkets {
    markets(first: 50) {
      nodes {
        id
        name
        handle
        status
        conditions {
          regionsCondition {
            regions(first: 250) {
              nodes {
                id
                name
                ... on MarketRegionCountry { code }
              }
            }
          }
        }
      }
    }
  }
`

const SHIPPING_DELIVERY_QUERY = `
  query PalasShippingRuleDeliveryProfiles {
    deliveryProfiles(first: 5, merchantOwnedOnly: true) {
      nodes {
        id
        name
        profileLocationGroups {
          locationGroup { id }
          locationGroupZones(first: 30) {
            nodes {
              zone {
                id
                name
                countries { code { countryCode restOfWorld } }
              }
              methodDefinitions(first: 30) {
                nodes {
                  id
                  name
                  active
                  methodConditions {
                    id
                    field
                    operator
                    conditionCriteria {
                      __typename
                      ... on MoneyV2 { amount currencyCode }
                    }
                  }
                  rateProvider {
                    __typename
                    ... on DeliveryRateDefinition { price { amount currencyCode } }
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

const SHIPPING_UPDATE_MUTATION = `
  mutation PalasUpdateShippingThreshold($id: ID!, $profile: DeliveryProfileInput!) {
    deliveryProfileUpdate(id: $id, profile: $profile) {
      profile { id }
      userErrors { field message }
    }
  }
`
