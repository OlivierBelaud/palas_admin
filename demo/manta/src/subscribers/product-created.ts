// Subscriber: product.created — increment stats counter
import type { Message, ILoggerPort } from '@manta/core'
import type { StatsService } from '../modules/stats/service'

export default {
  event: 'product.created',
  handler: async (msg: Message, resolve: <T>(key: string) => T) => {
    const logger = resolve<ILoggerPort>('ILoggerPort')
    const data = msg.data as { sku: string; title: string; price: number }
    logger.info(`Product created: ${data.sku} — "${data.title}" at ${data.price}€`)

    const statsService = resolve<StatsService>('statsService')
    await statsService.increment('total_products')
  },
}
