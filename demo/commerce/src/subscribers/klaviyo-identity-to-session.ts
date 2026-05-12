// Subscriber: posthog.klaviyo-identity-resolved → markSessionEmailAcquired
//
// The plugin-posthog-proxy emits this framework event every time it
// resolves a Klaviyo identity (from the $_kx / $kla_id exchange tokens).
// We use it to stamp the currently-open visitor_session as
// `email_acquired_in_session = true, email_acquired_via = 'newsletter'`.
//
// Why a separate subscriber: keeps the Klaviyo identity bridge in
// plugin-posthog-proxy schema-free (no `visitor_session` knowledge in
// the plugin). The demo decides what to do with the synthetic event.
//
// Event name is kebab-case (no underscores) to satisfy the framework
// subscriber-name regex (`[a-zA-Z0-9][a-zA-Z0-9.-]*`).

export default defineSubscriber({
  event: 'posthog.klaviyo-identity-resolved',
  subscriberId: 'klaviyo-identity-to-session',
  handler: async (message, { command, log }) => {
    const data = message.data as { distinct_id?: string; email?: string } | undefined
    const distinctId = data?.distinct_id ?? null
    const email = data?.email ?? null
    if (!distinctId || !email) {
      log.warn(
        `[klaviyo-identity-to-session] missing distinct_id or email — skipping (distinct_id=${distinctId ?? 'null'}, email=${email ?? 'null'})`,
      )
      return
    }

    // Two independent updates — both idempotent — fired with isolated error
    // handlers so a failure in one doesn't prevent the other.
    try {
      // biome-ignore lint/suspicious/noExplicitAny: command registry is dynamically typed
      await (command as any).markSessionEmailAcquired({ distinct_id: distinctId, email, via: 'newsletter' })
    } catch (err) {
      log.error(
        `[klaviyo-identity-to-session] markSessionEmailAcquired failed for distinct_id=${distinctId}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    try {
      // Backfill contact.distinct_id when the contact exists (Klaviyo-synced)
      // but never had a PostHog session linked to it before. Without this
      // step, every newsletter-only contact stays unlinked forever and their
      // future sessions all classify as 'unknown'.
      // biome-ignore lint/suspicious/noExplicitAny: command registry is dynamically typed
      await (command as any).linkContactDistinctIdByEmail({ email, distinct_id: distinctId })
    } catch (err) {
      log.error(
        `[klaviyo-identity-to-session] linkContactDistinctIdByEmail failed for email=${email}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  },
})
