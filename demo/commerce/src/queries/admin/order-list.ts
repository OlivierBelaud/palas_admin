import { readRows } from '../../utils/drizzle-read'

export default defineQuery({
  name: 'order-list',
  description: 'List orders for the admin orders table',
  input: z.object({}),
  handler: async (_input, { db, schema }) =>
    readRows(
      { db, schema },
      {
        entity: 'order',
        fields: [
          'order_number',
          'email',
          'status',
          'total_price',
          'sales_channel',
          'include_in_ecommerce_analytics',
          'placed_at',
          'fulfillment_status',
        ],
        sort: { placed_at: 'desc' },
        pagination: { limit: 1000 },
      },
    ),
})
