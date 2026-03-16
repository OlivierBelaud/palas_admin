// InventoryService — in-memory implementation for demo scenario

import type { InventoryItemData } from './models/inventory-item'

export class InventoryService {
  private _items = new Map<string, InventoryItemData>()

  async createStock(data: { sku: string; quantity: number; warehouse?: string }): Promise<InventoryItemData> {
    const id = `inv_${crypto.randomUUID().slice(0, 8)}`
    const now = new Date()

    const item: InventoryItemData = {
      id,
      sku: data.sku,
      quantity: data.quantity,
      reorder_point: 10,
      warehouse: data.warehouse ?? 'default',
      created_at: now,
      updated_at: now,
    }

    this._items.set(id, item)
    return { ...item }
  }

  async setReorderPoint(sku: string, point: number): Promise<void> {
    for (const item of this._items.values()) {
      if (item.sku === sku) {
        item.reorder_point = point
        item.updated_at = new Date()
        return
      }
    }
    throw new Error(`Inventory item with SKU "${sku}" not found`)
  }

  async findBySku(sku: string): Promise<InventoryItemData | null> {
    for (const item of this._items.values()) {
      if (item.sku === sku) return { ...item }
    }
    return null
  }

  async isLowStock(sku: string): Promise<boolean> {
    const item = await this.findBySku(sku)
    if (!item) return false
    return item.quantity <= item.reorder_point
  }

  async delete(id: string): Promise<void> {
    this._items.delete(id)
  }

  _reset(): void {
    this._items.clear()
  }
}
