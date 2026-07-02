type MarketingRuleType = 'order_discount' | 'gift_threshold' | 'shipping_threshold'
type ExecutionKind = 'shopify_discount' | 'local_cart_rule' | 'shipping_profile'

interface MarketingRuleRow {
  id: string
  shopify_id?: string | null
}

interface EntityCrud<Row> {
  create: (data: Record<string, unknown>) => Promise<Row>
  update: (id: string, data: Record<string, unknown>) => Promise<Row>
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
}

const inputSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().trim().min(1),
  rule_type: z.enum(['order_discount', 'gift_threshold', 'shipping_threshold']),
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
})

export default defineCommand({
  name: 'upsertMarketingRule',
  description: 'Create or update a Palas marketing rule and route it to Shopify/local execution.',
  input: inputSchema,
  workflow: async (input, { step, log }) => {
    validateMarketingRule(input)
    const executionKind = executionKindFor(input.rule_type)
    const svc = step.service as unknown as { marketingRule: EntityCrud<MarketingRuleRow> }
    let shopifyId: string | null = null
    let syncStatus: 'local_only' | 'synced' | 'pending' | 'error' =
      executionKind === 'local_cart_rule' ? 'local_only' : 'pending'
    let syncError: string | null = null

    if (executionKind === 'shopify_discount' && input.status !== 'draft') {
      try {
        const commands = step.command as unknown as {
          upsertShopifyDiscount: (input: Record<string, unknown>) => Promise<{ id?: string }>
        }
        const result = await commands.upsertShopifyDiscount({
          id: input.id ? undefined : undefined,
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
      payload: { source: 'palas_admin' },
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

function executionKindFor(ruleType: MarketingRuleType): ExecutionKind {
  if (ruleType === 'order_discount') return 'shopify_discount'
  if (ruleType === 'shipping_threshold') return 'shipping_profile'
  return 'local_cart_rule'
}

function validateMarketingRule(input: MarketingRuleInput) {
  if (input.rule_type === 'order_discount') {
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
