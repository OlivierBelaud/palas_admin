
export default defineCommand({
  name: 'createCustomerGroupWithMembers',
  description: 'Create a customer group and optionally add customers to it',
  input: z.object({
    name: z.string(),
    customer_ids: z.array(z.string()).optional(),
  }),
  workflow: async (input, { step }) => {
    const { customer_ids, ...groupData } = input

    const group = await step.command.createCustomerGroup(groupData) as { id: string; name: string }

    if (customer_ids && customer_ids.length > 0) {
      for (const customerId of customer_ids) {
        await step.command.linkCustomerCustomerGroup({
          customer_id: customerId,
          customer_group_id: group.id,
        })
      }
    }

    await step.emit('customer-group.created', { id: group.id, name: input.name })
    return group
  },
})
