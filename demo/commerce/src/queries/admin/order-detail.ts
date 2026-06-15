import { readRows } from '../../utils/drizzle-read'

export default defineQuery({
  name: 'order-detail',
  description: 'Flat order detail fields for dashboard cards',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { db, schema }) => {
    const rows = await readRows(
      { db, schema },
      {
        entity: 'order',
        filters: { id: input.id },
        fields: [
          'status',
          'financial_status',
          'fulfillment_status',
          'currency',
          'total_price',
          'placed_at',
          'cancelled_at',
          'items',
        ],
        pagination: { limit: 1 },
      },
    )

    return rows[0] ?? null
  },
})
