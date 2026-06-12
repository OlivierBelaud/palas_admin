export default defineSubscriber({
  event: 'posthog.events.received',
  subscriberId: 'identity-resolution-shadow',
  handler: async (_message, { log }) => {
    log.debug('[identity-resolution-shadow] disabled; subscriber command dispatch leaves workflow runs pending in prod')
  },
})
