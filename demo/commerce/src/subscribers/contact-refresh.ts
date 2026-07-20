export default defineSubscriber({
  event: 'contact.refresh-requested',
  subscriberId: 'contact-refresh',
  handler: async (message, { command, log }) => {
    const data = message.data as { email?: string; reason?: string; source?: string } | undefined
    const email = data?.email?.trim().toLowerCase()
    if (!email) {
      log.warn('[contact-refresh] missing email — skipping')
      return
    }
    try {
      // biome-ignore lint/suspicious/noExplicitAny: command registry is dynamically typed.
      await (command as any).refreshContact({
        email,
        reason: data?.reason ?? 'unknown',
        source: data?.source ?? 'unknown',
        dryRun: false,
      })
    } catch (err) {
      log.error(`[contact-refresh] refreshContact failed for ${email}: ${(err as Error).message}`)
      throw err
    }
  },
})
