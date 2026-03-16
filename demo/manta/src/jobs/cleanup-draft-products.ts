// Job: cleanup-draft-products — removes old draft products
import type { IContainer, ILoggerPort, IEventBusPort } from '@manta/core'
import type { ProductService } from '../modules/product'

export default {
  name: 'cleanup-draft-products',
  schedule: '0 */6 * * *', // every 6 hours
  handler: async (container: IContainer) => {
    const logger = container.resolve<ILoggerPort>('ILoggerPort')
    const productService = container.resolve<ProductService>('productService')
    const eventBus = container.resolve<IEventBusPort>('IEventBusPort')

    const deletedIds = await productService.deleteDraftsOlderThan(24)

    for (const id of deletedIds) {
      await eventBus.emit({
        eventName: 'product.cleaned',
        data: { id },
        metadata: { timestamp: Date.now() },
      })
    }

    logger.info(`Cleanup: ${deletedIds.length} draft products removed`)
    return { deleted: deletedIds.length }
  },
}
