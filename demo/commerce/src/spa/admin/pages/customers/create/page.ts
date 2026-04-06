import { defineForm } from '@manta/dashboard-core'

export default defineForm({
  title: 'Create Customer',
  command: 'createCustomer',
  fields: [
    { key: 'email', label: 'Email', type: 'text' },
    [{ key: 'first_name', label: 'First Name', type: 'text' }, { key: 'last_name', label: 'Last Name', type: 'text' }],
    [{ key: 'phone', label: 'Phone', type: 'text' }, { key: 'company_name', label: 'Company', type: 'text' }],
  ],
})
