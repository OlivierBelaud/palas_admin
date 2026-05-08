// Order -> Contact (N:1 cross-module link).
// Many orders can map to one contact (repeat customer). The Shopify
// sync workers (Phase 2) attach orders by email lookup against
// `contacts`.
export default defineLink(many('order'), 'contact')
