// Subscriber: inventory.low-stock — create notification file

export default defineSubscriber('inventory.low-stock', async (event, { command }) => {
  const { productId, quantity } = event.data as { productId: string; quantity: number }
  // TODO: await command.sendLowStockNotification({ productId, quantity })
})
