// Sub-workflow: initialize-inventory — creates stock + sets reorder rule
import { createWorkflow, step } from '@manta/core'
import type { InventoryService } from '../modules/inventory'

export const initializeInventory = createWorkflow({
  name: 'initialize-inventory',
  steps: [
    step({
      name: 'create-stock',
      handler: async ({ input, context }) => {
        const inventoryService = context.resolve<InventoryService>('inventoryService')
        const item = await inventoryService.createStock({
          sku: input.sku as string,
          quantity: input.initialQuantity as number,
        })
        return { inventoryItem: item }
      },
      compensation: async ({ output, context }) => {
        const inventoryService = context.resolve<InventoryService>('inventoryService')
        const item = output.inventoryItem as { id: string }
        await inventoryService.delete(item.id)
      },
    }),

    step({
      name: 'set-reorder-rule',
      handler: async ({ input, context }) => {
        const inventoryService = context.resolve<InventoryService>('inventoryService')
        await inventoryService.setReorderPoint(
          input.sku as string,
          input.reorderPoint as number,
        )
        return {
          sku: input.sku,
          quantity: input.initialQuantity,
          reorderPoint: input.reorderPoint,
        }
      },
    }),
  ],
})
