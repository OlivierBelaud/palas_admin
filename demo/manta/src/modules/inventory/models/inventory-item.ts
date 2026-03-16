// InventoryItem model — DML definition per DEMO_SCENARIO_SPEC
import { model } from '@manta/core'

export const InventoryItem = model.define('InventoryItem', {
  id: model.id(),
  sku: model.text(),
  quantity: model.number(),
  reorder_point: model.number(),
  warehouse: model.text(),
  created_at: model.dateTime(),
  updated_at: model.dateTime(),
})

export interface InventoryItemData {
  id: string
  sku: string
  quantity: number
  reorder_point: number
  warehouse: string
  created_at: Date
  updated_at: Date
}
