
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

    const group = await step.command.updateCustomerGroup({ id, ...data }) as { id: string; name: string }

    if (customer_ids_to_add) {
      for (const customerId of customer_ids_to_add) {
        try {
          await step.command.linkCustomerCustomerGroup({
            customer_id: customerId,
            customer_group_id: id,
          })
        } catch { /* already linked */ }
      }
    }

    if (customer_ids_to_remove) {
      for (const customerId of customer_ids_to_remove) {
        try {
          await step.command.unlinkCustomerCustomerGroup({
            customer_id: customerId,
            customer_group_id: id,
          })
        } catch { /* not linked */ }
      }
    }

    await step.emit('customer-group.updated', { id })
    return group
  },
})
