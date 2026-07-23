// Manual workflow adapter for the canonical PostHog -> visitor_sessions
// projection. Pagination, resume and identity behavior live exclusively in
// utils/visitor-session-sync.ts.

import { type RuntimeDatabase, runVisitorSessionSync } from '../../utils/visitor-session-sync'
import { posthogPrivateKey } from '../../utils/posthog-query'

const DEFAULT_MANUAL_LOOKBACK_MINUTES = 24 * 60

export default defineCommand({
  name: 'syncVisitorSessions',
  description: 'Fold recent PostHog session events into visitor_sessions without storing raw events locally',
  input: z.object({
    lookbackMinutes: z.number().min(1).max(1440).optional(),
  }),
  workflow: async (input, { step, log }) => {
    const key = posthogPrivateKey()
    if (!key) {
      throw new MantaError('INVALID_STATE', 'POSTHOG_API_KEY is required for syncVisitorSessions')
    }

    return await step.action('sync-visitor-sessions', {
      invoke: async (_input: unknown, context) => {
        const db = context.app.resolve('IDatabasePort') as RuntimeDatabase | undefined
        if (!db?.raw) throw new MantaError('UNEXPECTED_STATE', 'No database configured')

        const result = await runVisitorSessionSync({
          db,
          privateKey: key,
          // Preserve the manual command's historical full-day replay default.
          // The scheduled adapter uses the canonical engine's 15-minute overlap.
          lookbackMinutes: input.lookbackMinutes ?? DEFAULT_MANUAL_LOOKBACK_MINUTES,
          signal: context.signal,
          log,
        })
        if (context.signal?.aborted) {
          throw new MantaError('CONFLICT', 'syncVisitorSessions cancelled', { code: 'WORKFLOW_CANCELLED' })
        }
        return result
      },
      compensate: async () => {
        // The canonical engine deduplicates each session by event UUID.
      },
    })({})
  },
})
