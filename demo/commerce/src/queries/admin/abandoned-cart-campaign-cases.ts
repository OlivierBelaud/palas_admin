export default defineQuery({
  name: 'abandoned-cart-campaign-cases',
  description: 'Abandoned-cart campaign cases with message ladder status.',
  input: z.object({
    limit: z.number().int().positive().max(500).default(100),
    offset: z.number().int().min(0).default(0),
    days: z.number().int().positive().max(180).default(30),
  }),
  handler: async (input, { query }) => {
    const since = new Date(Date.now() - (input.days ?? 30) * 86400 * 1000)
    const [cases, count] = (await query.graphAndCount({
      entity: 'abandonedCartCase',
      filters: { opened_at: { $gte: since } },
      fields: [
        'id',
        'cart_id',
        'email',
        'case_type',
        'status',
        'current_sequence_version',
        'sequence_started_at',
        'stage_at_open',
        'last_cart_action_at',
        'opened_at',
        'recovered_at',
        'recovered_order_id',
        'recovered_amount',
        'recovered_source_message_id',
      ],
      sort: { opened_at: 'desc' },
      pagination: { limit: input.limit ?? 100, offset: input.offset ?? 0 },
    })) as unknown as [
      Array<{
        id: string
        cart_id: string
        email: string
        case_type: string
        status: string
        current_sequence_version: number
        sequence_started_at: Date | string | null
        stage_at_open: string | null
        last_cart_action_at: Date | string
        opened_at: Date | string
        recovered_at: Date | string | null
        recovered_order_id: string | null
        recovered_amount: number | null
        recovered_source_message_id: string | null
      }>,
      number,
    ]

    const caseIds = cases.map((c) => c.id)
    const messages =
      caseIds.length === 0
        ? []
        : ((await query.graph({
            entity: 'abandonedCartMessage',
            filters: { case_id: { $in: caseIds } },
            fields: [
              'id',
              'case_id',
              'message_type',
              'sequence_version',
              'sequence_started_at',
              'status',
              'scheduled_for',
              'sent_at',
              'skip_reason',
            ],
            sort: { scheduled_for: 'asc' },
            pagination: { limit: 5000 },
          })) as Array<{
            id: string
            case_id: string
            message_type: string
            sequence_version: number
            sequence_started_at: Date | string | null
            status: string
            scheduled_for: Date | string
            sent_at: Date | string | null
            skip_reason: string | null
          }>)

    const byCase = new Map<string, typeof messages>()
    for (const m of messages) {
      const list = byCase.get(m.case_id) ?? []
      list.push(m)
      byCase.set(m.case_id, list)
    }

    const formatMessage = (list: typeof messages, type: string): string | null => {
      const m = list.find((row) => row.message_type === type)
      if (!m) return null
      if (m.status === 'sent') return 'sent'
      if (m.status === 'skipped') return m.skip_reason ? `skipped:${m.skip_reason}` : 'skipped'
      return m.status
    }

    return {
      items: cases.map((c) => {
        const list = byCase.get(c.id) ?? []
        const activeSequence = Number(c.current_sequence_version ?? 1)
        const activeList = list.filter((m) => m.sequence_version === activeSequence)
        const totalSequences = Math.max(activeSequence, ...list.map((m) => m.sequence_version))
        const sent = list.filter((m) => m.status === 'sent')
        const lastSent = sent
          .map((m) => (m.sent_at ? new Date(m.sent_at).getTime() : 0))
          .filter((t) => Number.isFinite(t) && t > 0)
          .sort((a, b) => b - a)[0]
        return {
          ...c,
          current_sequence_version: activeSequence,
          total_sequences: totalSequences,
          sequence_started_at: c.sequence_started_at ? new Date(c.sequence_started_at).toISOString() : null,
          email_1: formatMessage(activeList, 'abandoned_cart_1'),
          email_2: formatMessage(activeList, 'abandoned_cart_2'),
          email_3: formatMessage(activeList, 'abandoned_cart_3'),
          payment_help: formatMessage(activeList, 'payment_help_1'),
          messages_sent: sent.length,
          last_sent_at: lastSent ? new Date(lastSent).toISOString() : null,
          recovered_by_message_type: list.find((m) => m.id === c.recovered_source_message_id)?.message_type ?? null,
        }
      }),
      count,
    }
  },
})
