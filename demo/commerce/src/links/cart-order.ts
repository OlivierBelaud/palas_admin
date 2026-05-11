// Cart -> Order (1:1). Set when checkout:completed event arrives or
// when the Shopify webhook upsert flows through upsertShopifyOrder.
export default defineLink('cart', 'order')
