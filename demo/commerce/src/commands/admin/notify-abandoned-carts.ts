// Manual admin command for the abandoned-cart campaign engine.
//
// Kept under the historical command name so existing admin buttons/scripts do
// not break, but the implementation now delegates to the same multi-message
// arbiter as the hourly cron. The old "one email per cart ever" helper is no
// longer the authoritative send path.

import { runAbandonedCartCampaign } from '../../utils/abandoned-cart-campaign'
import { resolveFile, resolveNotification, resolveSql } from '../../utils/manta-runtime'

export default defineCommand({
  name: 'notifyAbandonedCarts',
  description: 'Run the abandoned-cart campaign arbiter once.',
  input: z.object({
    batchLimit: z.number().int().positive().max(500).default(100),
    dryRun: z.boolean().default(false),
  }),
  workflow: async (input, { step, log }) => {
    const result = await step.action('notify-abandoned-carts-campaign', {
      invoke: async (_i: unknown, ctx) => {
        const sql = resolveSql(ctx.app)
        const notification = resolveNotification(ctx.app)
        const file = resolveFile(ctx.app)
        if (!sql || (!notification && !input.dryRun)) {
          throw new MantaError('UNEXPECTED_STATE', 'Database or notification port missing')
        }

        const dryRunNotification = {
          send: async () => {
            throw new MantaError('UNEXPECTED_STATE', 'Dry-run attempted an outbound notification')
          },
        }

        return await runAbandonedCartCampaign(
          {
            sql,
            notification: notification ?? dryRunNotification,
            file,
            adminBase: (process.env.ADMIN_BASE_URL ?? 'https://admin.fancypalas.com').replace(/\/+$/, ''),
            fromEmail: process.env.RESEND_FROM_EMAIL ?? 'Fancy Palas <hello@fancypalas.com>',
            replyTo: process.env.RESEND_REPLY_TO ?? 'hello@fancypalas.com',
            batchLimit: input.batchLimit,
            dryRun: input.dryRun,
            log,
          },
          ctx.signal,
        )
      },
      compensate: async (output, _ctx) => {
        log.warn(`[notifyAbandonedCarts] Non-compensable: ${output.sent} emails already sent`)
      },
    })({})

    log.info(
      `[notifyAbandonedCarts] scanned=${result.scanned} due=${result.due} sent=${result.sent} skipped=${result.skipped} recovered=${result.recovered} errors=${result.errors} claim_conflicts=${result.claim_conflicts}`,
    )
    return result
  },
})
