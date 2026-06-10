import { defineForm } from '@mantajs/dashboard'

export default defineForm({
  title: 'Create Customer Group',
  command: 'createCustomerGroupWithMembers',
  fields: [
    { key: 'name', label: 'Name', type: 'text' },
    {
      key: 'customer_ids',
      label: 'Customers',
      type: 'entity-select',
      entity: 'customer',
      multiple: true,
      displayFields: ['email', 'first_name', 'last_name'],
    },
  ],
})
