import type { RawDb } from '../../modules/cart-tracking/refresh-cart'
import { refreshLifecycleFacts } from '../../modules/visitor-session/lifecycle-facts'

export default defineCommand({
  name: 'refreshVisitorLifecycleFacts',
  description: 'Rebuild visitor lifecycle actor-day facts used by the lifecycle dashboard cache.',
  input: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    days: z.number().min(1).max(730).optional(),
  }),
  workflow: async (input, { step, log }) => {
    const result = await step.action('refresh-visitor-lifecycle-facts', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        const now = new Date()
        const to = input.to ? new Date(input.to) : now
        const from = input.from
          ? new Date(input.from)
          : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - (input.days ?? 35)))

        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
          throw new MantaError('INVALID_DATA', `Invalid lifecycle fact range from=${input.from} to=${input.to}`)
        }

        return refreshLifecycleFacts(db, { from, to })
      },
      compensate: async () => {},
    })({})

    log.info(
      `[refreshVisitorLifecycleFacts] from=${result.from} to=${result.to} days=${result.days} sessions=${result.sessions} facts=${result.facts} duration_ms=${result.duration_ms}`,
    )
    return result
  },
})
