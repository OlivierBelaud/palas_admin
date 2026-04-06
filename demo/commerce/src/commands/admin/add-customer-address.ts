import { z } from 'zod'

export default defineCommand({
  name: 'addCustomerAddress',
  description: 'Create an address and link it to a customer (shipping or billing)',
  input: z.object({
    customer_id: z.string(),
    type: z.enum(['shipping', 'billing']),
    is_default: z.boolean().default(false),
    address_name: z.string().optional(),
    company: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    address_1: z.string().optional(),
    address_2: z.string().optional(),
    city: z.string().optional(),
    country_code: z.string().optional(),
    province: z.string().optional(),
    postal_code: z.string().optional(),
    phone: z.string().optional(),
  }),
  workflow: async (input, { step }) => {
    const { customer_id, type, is_default, ...addressData } = input

    // Billing: enforce "one billing address per customer" by removing any existing billing link + address
    if (type === 'billing') {
      const existing = await step.link.customerAddress.list({ customer_id, type: 'billing' })
      if (existing.length > 0) {
        const oldAddressId = existing[0].address_id as string
        await step.link.customerAddress.delete({ customer_id, address_id: oldAddressId })
        await step.service.address.delete(oldAddressId)
      }
    }

    // Shipping default: unset any previously default shipping link
    if (type === 'shipping' && is_default) {
      const existing = await step.link.customerAddress.list({ customer_id, type: 'shipping', is_default: true })
      if (existing.length > 0) {
        await step.link.customerAddress.update(
          { customer_id, address_id: existing[0].address_id as string },
          { is_default: false },
        )
      }
    }

    const address = (await step.service.address.create(addressData)) as { id: string }

    await step.link.customerAddress.create({
      customer_id,
      address_id: address.id,
      type,
      is_default,
    })

    return address
  },
})
