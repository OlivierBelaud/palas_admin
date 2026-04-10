export default defineCommand({
  name: 'removeCustomerAddress',
  description: 'Unlink and delete an address from a customer',
  input: z.object({
    customer_id: z.string(),
    address_id: z.string(),
  }),
  workflow: async (input, { step }) => {
    const { customer_id, address_id } = input

    // step.link is typed as a callable at the type level; the runtime exposes per-link CRUD
    // namespaces on link names. Cast to access them.
    const linkCrud = step.link as unknown as Record<
      string,
      { delete: (where: Record<string, unknown>) => Promise<{ ok: true }> }
    >

    await linkCrud.customerAddress.delete({ customer_id, address_id })
    await step.service.address.delete(address_id)

    return { success: true }
  },
})
