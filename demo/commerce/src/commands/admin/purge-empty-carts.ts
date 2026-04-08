import { z } from 'zod'

export default defineCommand({
  name: 'purgeEmptyCarts',
  description: 'Delete all carts with 0 items and their associated events',
  input: z.object({}),
  workflow: async (_input, { step }) => {
    // Find all carts with 0 items
    const allCarts = await step.service.cart.list({})
    const emptyCarts = (allCarts as any[]).filter((c: any) => (c.item_count ?? 0) === 0)

    if (emptyCarts.length === 0) return { deleted: 0 }

    for (const cart of emptyCarts) {
      const cartId = (cart as any).id
      // Delete events for this cart
      const events = await step.service.cartEvent.list({ cart_id: cartId })
      for (const evt of events as any[]) {
        await step.service.cartEvent.delete((evt as any).id)
      }
      // Delete the cart
      await step.service.cart.delete(cartId)
    }

    return { deleted: emptyCarts.length }
  },
})
