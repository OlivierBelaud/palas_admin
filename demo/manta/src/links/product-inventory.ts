// Link: Product ↔ InventoryItem
// Pivot table: catalog_product_inventory_inventoryitem
// Cascade: when Product is deleted, linked InventoryItems are also soft-deleted.

export default defineLink('product', many('inventory_item'))
