export default defineQuery({
  name: 'cart-totals',
  description: 'Cart totals breakdown — feeds a 2-column DataList (label | currency).',
  input: z.object({ id: z.string() }),
  handler: async (input, { query }) => {
    const carts = await query.graph({
      entity: 'cart',
      filters: { id: input.id },
      fields: ['subtotal_price', 'shipping_price', 'discounts_amount', 'total_tax', 'total_price'],
      pagination: { limit: 1 },
    })
    const cart = carts[0]
    if (!cart) return { items: [] }

    const rows: Array<{ label: string; value: number; _emphasis?: boolean }> = []
    if (cart.subtotal_price != null) rows.push({ label: 'Sous-total', value: cart.subtotal_price })
    if (cart.shipping_price != null) rows.push({ label: 'Livraison', value: cart.shipping_price })
    if (cart.discounts_amount != null && cart.discounts_amount !== 0)
      rows.push({ label: 'Remises', value: -Math.abs(cart.discounts_amount) })
    if (cart.total_tax != null) rows.push({ label: 'TVA', value: cart.total_tax })
    if (cart.total_price != null) rows.push({ label: 'Total', value: cart.total_price, _emphasis: true })

    return { items: rows }
  },
})
