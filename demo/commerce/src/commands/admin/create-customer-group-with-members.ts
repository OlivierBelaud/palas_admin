type CustomerGroupMemberCommands = {
  createCustomerGroup(input: { name: string }): Promise<{ id: string; name: string }>
  linkCustomerCustomerGroup(input: { customer_id: string; customer_group_id: string }): Promise<unknown>
}

export default defineCommand({
  name: 'createCustomerGroupWithMembers',
  description: 'Create a customer group and optionally add customers to it',
  input: z.object({
    name: z.string(),
    customer_ids: z.array(z.string()).optional(),
  }),
  workflow: async (input, { step }) => {
    const { customer_ids, ...groupData } = input
    const commands = step.command as unknown as CustomerGroupMemberCommands

    const group = await commands.createCustomerGroup(groupData)

    if (customer_ids && customer_ids.length > 0) {
      for (const customerId of customer_ids) {
        await commands.linkCustomerCustomerGroup({
          customer_id: customerId,
          customer_group_id: group.id,
        })
      }
    }

    await step.emit('customer-group.created', { id: group.id, name: input.name })
    return group
  },
})
