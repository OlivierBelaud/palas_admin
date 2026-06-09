export default defineQuery({
  name: 'abandoned-cart-campaign-stats',
  description: 'Abandoned-cart campaign KPIs from cases/messages.',
  input: z.object({
    days: z.number().int().positive().max(180).default(30),
  }),
  handler: async (input, { query }) => {
    const since = new Date(Date.now() - (input.days ?? 30) * 86400 * 1000)
    const [cases, messages] = await Promise.all([
      query.graph({
        entity: 'abandonedCartCase',
        filters: { opened_at: { $gte: since } },
        fields: ['id', 'case_type', 'status', 'recovered_amount', 'recovered_source_message_id'],
        pagination: { limit: 10000 },
      }) as Promise<
        Array<{
          id: string
          case_type: string
          status: string
          recovered_amount: number | null
          recovered_source_message_id: string | null
        }>
      >,
      query.graph({
        entity: 'abandonedCartMessage',
        filters: { scheduled_for: { $gte: since } },
        fields: ['id', 'case_id', 'message_type', 'status', 'sent_at', 'skip_reason'],
        pagination: { limit: 20000 },
      }) as Promise<
        Array<{
          id: string
          case_id: string
          message_type: string
          status: string
          sent_at: Date | string | null
          skip_reason: string | null
        }>
      >,
    ])

    const sent = messages.filter((m) => m.status === 'sent')
    const skipped = messages.filter((m) => m.status === 'skipped')
    const recovered = cases.filter((c) => c.status === 'recovered')
    const recoveredByMessage = new Set(recovered.map((c) => c.recovered_source_message_id).filter(Boolean))
    const countSentType = (type: string) => sent.filter((m) => m.message_type === type).length
    const countRecoveredType = (type: string) =>
      sent.filter((m) => m.message_type === type && recoveredByMessage.has(m.id)).length
    const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0)

    const recoveredRevenue = recovered.reduce((sum, c) => sum + Number(c.recovered_amount ?? 0), 0)
    const skippedShopify = skipped.filter((m) => m.skip_reason === 'shopify_order_found').length
    const skippedKlaviyo = skipped.filter((m) => m.skip_reason === 'klaviyo_email_found').length
    const skippedOptout = skipped.filter((m) => m.skip_reason === 'opt_out').length

    return {
      total_cases: cases.length,
      open_cases: cases.filter((c) => c.status === 'open').length,
      recovered_cases: recovered.length,
      sent_messages: sent.length,
      skipped_messages: skipped.length,
      skipped_shopify: skippedShopify,
      skipped_klaviyo: skippedKlaviyo,
      skipped_optout: skippedOptout,
      recovered_revenue: recoveredRevenue,
      recovery_rate: rate(recovered.length, sent.length),
      email_1_sent: countSentType('abandoned_cart_1'),
      email_1_recovered: countRecoveredType('abandoned_cart_1'),
      email_1_recovery_rate: rate(countRecoveredType('abandoned_cart_1'), countSentType('abandoned_cart_1')),
      email_2_sent: countSentType('abandoned_cart_2'),
      email_2_recovered: countRecoveredType('abandoned_cart_2'),
      email_2_recovery_rate: rate(countRecoveredType('abandoned_cart_2'), countSentType('abandoned_cart_2')),
      email_3_sent: countSentType('abandoned_cart_3'),
      email_3_recovered: countRecoveredType('abandoned_cart_3'),
      email_3_recovery_rate: rate(countRecoveredType('abandoned_cart_3'), countSentType('abandoned_cart_3')),
      payment_help_sent: countSentType('payment_help_1'),
      payment_help_recovered: countRecoveredType('payment_help_1'),
      payment_help_recovery_rate: rate(countRecoveredType('payment_help_1'), countSentType('payment_help_1')),
    }
  },
})
