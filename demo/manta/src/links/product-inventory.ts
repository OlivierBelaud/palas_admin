// Link: Product ↔ Inventory — cross-module relation

export const productInventoryLink = {
  fromModule: 'product',
  fromField: 'id',
  toModule: 'inventory',
  toField: 'id',
  table: 'product_inventory_link',
}

// In-memory link store for demo
export class ProductInventoryLinkStore {
  private _links = new Map<string, string>() // productId → inventoryItemId

  set(productId: string, inventoryItemId: string): void {
    this._links.set(productId, inventoryItemId)
  }

  getInventoryId(productId: string): string | undefined {
    return this._links.get(productId)
  }

  getProductId(inventoryItemId: string): string | undefined {
    for (const [pid, iid] of this._links) {
      if (iid === inventoryItemId) return pid
    }
    return undefined
  }

  delete(productId: string): void {
    this._links.delete(productId)
  }

  _reset(): void {
    this._links.clear()
  }
}
