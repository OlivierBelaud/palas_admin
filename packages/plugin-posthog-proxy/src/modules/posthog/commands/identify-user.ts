import { defineCommand } from '@manta/core'
import { PostHog } from 'posthog-node'
import { postHogIdentifyInputSchema } from '../schemas'

export default defineCommand({
  name: 'posthog:identify-user',
  description:
    'Identify an anonymous PostHog visitor with their properties. Links all past anonymous events to the known user.',
  input: postHogIdentifyInputSchema,
  async workflow(input, { step }) {
    // step.action signature: (name, { invoke, compensate }) → returns a runner function
    // that you must call with (input, ctx) to execute. Compensate is mandatory but a no-op
    // here: identify writes are idempotent and there's no PostHog primitive to "un-identify".
    return step.action('posthog-identify', {
      invoke: async () => {
        const token = process.env.POSTHOG_TOKEN
        if (!token) return { success: false, error: 'POSTHOG_TOKEN env var not set' }

        const posthog = new PostHog(token, { host: process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com' })
        posthog.identify({
          distinctId: input.distinctId,
          properties: input.properties,
        })
        await posthog.shutdown()
        return { success: true }
      },
      compensate: async () => {
        // No-op — identify writes are idempotent.
      },
    })(input)
  },
})
