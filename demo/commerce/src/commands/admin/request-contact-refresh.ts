export default defineCommand({
  name: 'requestContactRefresh',
  description: 'Emit a contact.refresh-requested ping. The subscriber performs the actual source refresh.',
  input: z.object({
    email: z.string().email(),
    reason: z.string().default('unknown'),
    source: z.string().default('unknown'),
  }),
  workflow: async (input, { step, log }) => {
    const email = input.email.trim().toLowerCase()
    await step.emit('contact.refresh-requested', {
      email,
      reason: input.reason,
      source: input.source,
      requested_at: new Date().toISOString(),
    })
    log.info(`[requestContactRefresh] email=${email} source=${input.source} reason=${input.reason}`)
    return { requested: true, email }
  },
})
