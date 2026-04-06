import { defineCommand } from '@manta/core'
import { PostHog } from 'posthog-node'
import { postHogCaptureInputSchema } from '../schemas'

export default defineCommand({
  name: 'posthog:track-event',
  description:
    'Track a custom analytics event in PostHog (page view, click, purchase, sign-up, etc.). Use for sending server-side events.',
  input: postHogCaptureInputSchema,
  async workflow(input, { step }) {
    // step.action signature: (name, { invoke, compensate }) → returns a runner function
    // that you must call with (input, ctx) to execute. Compensate is mandatory but a no-op
    // here: PostHog events are immutable once sent, so there's nothing to rollback if a
    // later step in the workflow fails.
    return step.action('posthog-capture', {
      invoke: async () => {
        const token = process.env.POSTHOG_TOKEN
        if (!token) return { success: false, error: 'POSTHOG_TOKEN env var not set' }

        const posthog = new PostHog(token, { host: process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com' })
        posthog.capture({
          event: input.event,
          distinctId: input.distinctId,
          properties: input.properties,
        })
        await posthog.shutdown()
        return { success: true }
      },
      compensate: async () => {
        // No-op — events are immutable.
      },
    })(input)
  },
})
