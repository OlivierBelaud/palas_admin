// Subscriber: inventory.low-stock — create notification file
import type { Message, ILoggerPort } from '@manta/core'
import type { FileService } from '../modules/file/service'

export default {
  event: 'inventory.low-stock',
  handler: async (msg: Message, resolve: <T>(key: string) => T) => {
    const logger = resolve<ILoggerPort>('ILoggerPort')
    const data = msg.data as { sku: string; quantity: number; reorderPoint: number }
    logger.warn(`LOW STOCK NOTIFICATION: ${data.sku} needs reorder (${data.quantity} units left)`)

    const fileService = resolve<FileService>('fileService')
    await fileService.write(
      `notifications/low-stock-${data.sku}-${Date.now()}.json`,
      Buffer.from(JSON.stringify({
        type: 'low-stock',
        sku: data.sku,
        quantity: data.quantity,
        timestamp: new Date().toISOString(),
      })),
    )
  },
}
