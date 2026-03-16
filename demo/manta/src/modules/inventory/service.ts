// InventoryService — Drizzle ORM implementation

import { eq } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { inventoryItems } from "@manta/core/db"
import type { InventoryItemData } from './models/inventory-item'

export class InventoryService {
  private db: PostgresJsDatabase

  constructor(db: PostgresJsDatabase) {
    this.db = db
  }

  async createStock(data: { sku: string; quantity: number; warehouse?: string }): Promise<InventoryItemData> {
    const id = `inv_${crypto.randomUUID().slice(0, 8)}`
    const warehouse = data.warehouse ?? 'default'

    const [item] = await this.db.insert(inventoryItems).values({
      id,
      sku: data.sku,
      quantity: data.quantity,
      reorder_point: 10,
      warehouse,
      created_at: new Date(),
      updated_at: new Date(),
    }).returning()

    return item as InventoryItemData
  }

  async setReorderPoint(sku: string, point: number): Promise<void> {
    const result = await this.db.update(inventoryItems)
      .set({ reorder_point: point, updated_at: new Date() })
      .where(eq(inventoryItems.sku, sku))
      .returning({ id: inventoryItems.id })

    if (result.length === 0) {
      throw new Error(`Inventory item with SKU "${sku}" not found`)
    }
  }

  async findBySku(sku: string): Promise<InventoryItemData | null> {
    const [item] = await this.db.select().from(inventoryItems)
      .where(eq(inventoryItems.sku, sku))
      .limit(1)

    return (item as InventoryItemData) ?? null
  }

  async isLowStock(sku: string): Promise<boolean> {
    const item = await this.findBySku(sku)
    if (!item) return false
    return item.quantity <= item.reorder_point
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(inventoryItems).where(eq(inventoryItems.id, id))
  }

  async _reset(): Promise<void> {
    await this.db.delete(inventoryItems)
  }
}
