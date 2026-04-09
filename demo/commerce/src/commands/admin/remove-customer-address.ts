
export default defineCommand({
  name: 'removeCustomerAddress',
  description: 'Unlink and delete an address from a customer',
  input: z.object({
    customer_id: z.string(),
    address_id: z.string(),
  }),
  workflow: async (input, { step }) => {
    const { customer_id, address_id } = input

    await step.link.customerAddress.delete({ customer_id, address_id })
    await step.service.address.delete(address_id)

    return { success: true }
  },
})
