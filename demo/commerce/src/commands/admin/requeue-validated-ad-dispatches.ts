import { requeueValidatedAdDispatches } from '../../modules/event-hub/ad-dispatch-repair'
import type { RawDispatchDb } from '../../modules/event-hub/dispatch-runner'

export default defineCommand({
  name: 'requeueValidatedAdDispatches',
  description: 'Explicitly requeue selected advertising test receipts after checking the current provider mode.',
  input: z.object({
    destination: z.enum(['google_ads', 'pinterest']),
    eventIds: z.array(z.string().min(1).max(180)).min(1).max(20),
  }),
  workflow: async (input, { step }) =>
    step.action('requeue-validated-ad-dispatches', {
      invoke: async (_input: unknown, ctx) => {
        const db = ctx.app.resolve('IDatabasePort') as RawDispatchDb | undefined
        if (!db?.raw) throw new MantaError('UNEXPECTED_STATE', 'No database configured')
        return requeueValidatedAdDispatches(db, input.destination, input.eventIds)
      },
      compensate: async () => {
        // Requeue is idempotent; do not undo a row another worker may have claimed.
      },
    })({}),
})
