interface MarketingRuleRow {
  id: string
}

interface EntityCrud<Row> {
  update: (id: string, data: Record<string, unknown>) => Promise<Row>
}

export default defineCommand({
  name: 'archiveMarketingRule',
  description: 'Archive a Palas-owned marketing rule from the marketing rules control center.',
  input: z.object({
    id: z.string().min(1),
  }),
  workflow: async (input, { step }) => {
    const svc = step.service as unknown as { marketingRule: EntityCrud<MarketingRuleRow> }
    const row = await svc.marketingRule.update(input.id, {
      status: 'paused',
      deleted_at: new Date(),
    })
    await step.emit('marketing-rule.archived', { id: row.id })
    return row
  },
})
