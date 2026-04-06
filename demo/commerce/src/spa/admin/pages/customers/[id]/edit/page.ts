import { defineForm } from '@manta/dashboard-core'

export default defineForm({
  title: 'Edit Customer',
  command: 'updateCustomer',
  query: {
    graph: {
      entity: 'customer',
      fields: ['first_name', 'last_name', 'email', 'phone', 'company_name'],
    },
  },
  fields: [
    { key: 'first_name', label: 'First Name', type: 'text' },
    { key: 'last_name', label: 'Last Name', type: 'text' },
    { key: 'email', label: 'Email', type: 'text', required: true },
    { key: 'phone', label: 'Phone', type: 'text' },
    { key: 'company_name', label: 'Company', type: 'text' },
  ],
})
