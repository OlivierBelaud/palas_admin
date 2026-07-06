import { readGiftVariantId, restoreShopifyGiftVariant } from './upsert-marketing-rule'

interface MarketingRuleRow {
  id: string
  rule_type?: string | null
  gift_product_id?: string | null
  payload?: Record<string, unknown> | null
}

interface EntityCrud<Row> {
  update: (id: string, data: Record<string, unknown>) => Promise<Row>
  list: (filters: Record<string, unknown>, options?: Record<string, unknown>) => Promise<Row[]>
}

export default defineCommand({
  name: 'archiveMarketingRule',
  description: 'Archive a Palas-owned marketing rule from the marketing rules control center.',
  input: z.object({
    id: z.string().min(1),
  }),
  workflow: async (input, { step, log }) => {
    const svc = step.service as unknown as { marketingRule: EntityCrud<MarketingRuleRow> }
    const existing = (await svc.marketingRule.list({ id: input.id }, { take: 1 }))[0]
    if (existing?.rule_type === 'gift_threshold') {
      const variantId = existing.gift_product_id ?? readGiftVariantId(existing.payload)
      if (variantId) {
        try {
          await restoreShopifyGiftVariant(variantId, existing.payload)
        } catch (err) {
          log.warn(`[archiveMarketingRule] Shopify gift restore failed: ${(err as Error).message}`)
        }
      }
    }
    const row = await svc.marketingRule.update(input.id, {
      status: 'paused',
      deleted_at: new Date(),
    })
    await step.emit('marketing-rule.archived', { id: row.id })
    return row
  },
})
