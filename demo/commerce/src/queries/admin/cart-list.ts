
const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', CAD: 'CA$', AUD: 'A$' }

export default defineQuery({
  name: 'cart-list',
  description: 'List carts with computed client display and formatted amounts',
  input: z.object({}).optional(),
  handler: async (_input, { query }) => {
    const carts = await query.graph({
      entity: 'cart',
      fields: [
        'email', 'first_name', 'last_name', 'distinct_id',
        'total_price', 'item_count', 'currency',
        'last_action', 'highest_stage', 'status', 'last_action_at', 'created_at',
      ],
      pagination: { limit: 100 },
      sort: { last_action_at: 'desc' },
    }) as any[]

    return carts.map((c: any) => {
      const currency = c.currency ?? 'EUR'
      const client = c.email
        ?? (c.distinct_id ? `${c.distinct_id.slice(0, 8)}…` : 'Anonyme')
      const symbol = SYMBOLS[currency] ?? currency
      // Durée de vie: diff entre created_at et last_action_at
      let duree = '-'
      if (c.created_at && c.last_action_at) {
        const diffMs = new Date(c.last_action_at).getTime() - new Date(c.created_at).getTime()
        const mins = Math.floor(diffMs / 60000)
        if (mins < 1) duree = '< 1 min'
        else if (mins < 60) duree = `${mins} min`
        else if (mins < 1440) duree = `${Math.floor(mins / 60)}h ${mins % 60}min`
        else duree = `${Math.floor(mins / 1440)}j ${Math.floor((mins % 1440) / 60)}h`
      }

      return {
        ...c,
        client,
        montant: c.total_price != null ? `${c.total_price} ${symbol}` : '-',
        duree,
      }
    })
  },
})
