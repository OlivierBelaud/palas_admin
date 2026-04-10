// Subscriber: customer-group.created / customer-group.updated → log audit line
//
// The create-customer-group-with-members and update-customer-group-with-members
// commands emit these events but until now nobody listened. This subscriber is
// a minimal working example that simply logs — it exists to:
//  1. Close the "orphan emitter" finding (events with no subscribers).
//  2. Serve as a reference pattern for future audit/audit-log subscribers.
//
// It deliberately does no DB work — the point is to prove the subscriber
// dispatch path end-to-end in the demo.

export default defineSubscriber({
  event: ['customer-group.created', 'customer-group.updated'],
  subscriberId: 'customer-group-audit',
  handler: async (message, { log }) => {
    const data = message.data as { id?: string; name?: string } | undefined
    log.info(
      `[customer-group-audit] ${message.eventName} — id=${data?.id ?? '?'}${data?.name ? ` name=${data.name}` : ''}`,
    )
  },
})
