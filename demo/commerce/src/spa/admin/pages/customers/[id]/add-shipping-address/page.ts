import { defineForm } from '@manta/dashboard-core'

export default defineForm({
  title: 'Add Shipping Address',
  command: 'addCustomerAddress',
  hiddenFields: {
    customer_id: ':id',
    type: 'shipping',
  },
  fields: [
    { key: 'address_name', label: 'Address Name', type: 'text', placeholder: 'Home, Office, Warehouse...' },
    { key: 'is_default', label: 'Set as default shipping address', type: 'toggle' },
    [{ key: 'first_name', label: 'Recipient First Name', type: 'text' }, { key: 'last_name', label: 'Recipient Last Name', type: 'text' }],
    { key: 'company', label: 'Company', type: 'text' },
    { key: 'address_1', label: 'Address Line 1', type: 'text' },
    { key: 'address_2', label: 'Address Line 2', type: 'text' },
    [{ key: 'postal_code', label: 'Postal Code', type: 'text' }, { key: 'city', label: 'City', type: 'text' }],
    [{ key: 'province', label: 'Province / State', type: 'text' }, { key: 'country_code', label: 'Country Code', type: 'text', placeholder: 'FR, US, DE...' }],
    { key: 'phone', label: 'Phone', type: 'text' },
  ],
})
