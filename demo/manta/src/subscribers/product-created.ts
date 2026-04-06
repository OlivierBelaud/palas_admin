// Subscriber: product.created — increment stats counter

export default defineSubscriber('product.created', async (event, { command }) => {
  const { sku } = event.data as { sku: string; title: string; price: number }
  // TODO: await command.incrementStats({ key: 'total_products', metadata: { sku } })
})
