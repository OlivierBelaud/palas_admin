// Subscriber: inventory.stocked — check for low stock

export default defineSubscriber('inventory.stocked', async (event, { command }) => {
  const { productId, quantity, reorderPoint } = event.data as {
    productId: string
    quantity: number
    reorderPoint: number
  }
  // TODO: await command.checkLowStock({ productId, quantity, reorderPoint })
})
