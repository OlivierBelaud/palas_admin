// Subscriber: inventory.stocked — check for low stock
import type { Message, ILoggerPort, IEventBusPort } from '@manta/core'

export default {
  event: 'inventory.stocked',
  handler: async (msg: Message, resolve: <T>(key: string) => T) => {
    const logger = resolve<ILoggerPort>('ILoggerPort')
    const data = msg.data as { sku: string; quantity: number; reorderPoint: number }
    logger.info(`Inventory stocked: ${data.sku} — ${data.quantity} units`)

    if (data.quantity <= data.reorderPoint) {
      logger.warn(`Low stock alert: ${data.sku} (${data.quantity} <= ${data.reorderPoint})`)
      const eventBus = resolve<IEventBusPort>('IEventBusPort')
      await eventBus.emit({
        eventName: 'inventory.low-stock',
        data: {
          sku: data.sku,
          quantity: data.quantity,
          reorderPoint: data.reorderPoint,
        },
        metadata: { timestamp: Date.now() },
      })
    }
  },
}
