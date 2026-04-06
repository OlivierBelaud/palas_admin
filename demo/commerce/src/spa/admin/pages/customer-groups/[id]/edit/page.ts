import { defineForm } from '@manta/dashboard-core'

export default defineForm({
  title: 'Edit Customer Group',
  command: 'updateCustomerGroupWithMembers',
  query: {
    name: 'group-detail',
    input: { id: ':id' },
  },
  fields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'customer_ids', label: 'Customers', type: 'entity-select', entity: 'customer', multiple: true, displayFields: ['email', 'first_name', 'last_name'] },
  ],
})
