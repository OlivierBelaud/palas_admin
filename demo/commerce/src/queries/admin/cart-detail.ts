import { readRows } from '../../utils/drizzle-read'

export default defineQuery({
  name: 'cart-detail',
  description: 'Flat cart detail fields for dashboard cards',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { db, schema }) => {
    const rows = await readRows(
      { db, schema },
      {
        entity: 'cart',
        filters: { id: input.id },
        fields: [
          'email',
          'first_name',
          'last_name',
          'phone',
          'city',
          'country_code',
          'distinct_id',
          'shopify_customer_id',
          'items',
          'currency',
          'status',
          'highest_stage',
          'last_action',
          'last_action_at',
          'total_price',
          'subtotal_price',
          'discounts_amount',
          'shipping_method',
          'shipping_price',
          'total_tax',
          'checkout_token',
          'shopify_order_id',
          'is_first_order',
          'created_at',
          'updated_at',
        ],
        pagination: { limit: 1 },
      },
    )

    return rows[0] ?? null
  },
})
