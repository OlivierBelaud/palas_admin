export default defineSubscriber({
  event: 'posthog.events.received',
  subscriberId: 'canonical-event-log-shadow',
  handler: async (_message, { log }) => {
    log.debug(
      '[canonical-event-log-shadow] disabled; Event Hub ingest writes event_logs/dispatch_logs inline without workflow commands',
    )
  },
})
