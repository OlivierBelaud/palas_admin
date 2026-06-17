type CustomerGroupMemberCommands = {
  updateCustomerGroup(input: { id: string; name?: string }): Promise<{ id: string; name: string }>
  linkCustomerCustomerGroup(input: { customer_id: string; customer_group_id: string }): Promise<unknown>
  unlinkCustomerCustomerGroup(input: { customer_id: string; customer_group_id: string }): Promise<unknown>
}

export default defineCommand({
  name: 'updateCustomerGroupWithMembers',
  description: 'Update a customer group — name and/or customer membership',
  input: z.object({
    id: z.string(),
    name: z.string().optional(),
    customer_ids_to_add: z.array(z.string()).optional(),
    customer_ids_to_remove: z.array(z.string()).optional(),
  }),
  workflow: async (input, { step }) => {
    const { id, customer_ids_to_add, customer_ids_to_remove, ...data } = input
    const commands = step.command as unknown as CustomerGroupMemberCommands

    const group = await commands.updateCustomerGroup({ id, ...data })

    if (customer_ids_to_add) {
      for (const customerId of customer_ids_to_add) {
        try {
          await commands.linkCustomerCustomerGroup({
            customer_id: customerId,
            customer_group_id: id,
          })
        } catch {
          /* already linked */
        }
      }
    }

    if (customer_ids_to_remove) {
      for (const customerId of customer_ids_to_remove) {
        try {
          await commands.unlinkCustomerCustomerGroup({
            customer_id: customerId,
            customer_group_id: id,
          })
        } catch {
          /* not linked */
        }
      }
    }

    await step.emit('customer-group.updated', { id })
    return group
  },
})
