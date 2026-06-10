import { definePage } from '@mantajs/dashboard'

export default definePage({
  header: {
    titleField: 'name',
    actions: ['edit', 'delete'],
  },
  main: [
    {
      type: 'InfoCard',
      title: 'Details',
      query: {
        graph: {
          entity: 'customerGroup',
          fields: ['name', 'created_by'],
        },
      },
    },
    {
      type: 'RelationTable',
      title: 'Customers',
      query: {
        name: 'group-customers',
        input: { group_id: ':id' },
      },
      columns: [
        { key: 'email', label: 'Email', format: 'highlight' },
        { key: 'first_name', label: 'First Name' },
        { key: 'last_name', label: 'Last Name' },
        { key: 'phone', label: 'Phone' },
        {
          key: 'has_account',
          label: 'Account',
          format: { type: 'badge', true: { label: 'Yes', color: 'green' }, false: { label: 'No', color: 'orange' } },
        },
        { key: 'created_at', label: 'Joined', format: 'date' },
      ],
      searchable: true,
      // No navigateTo — the legacy /customers detail page was removed in
      // crm/old-customers-page-removed; customer-groups still manage their
      // own membership but rows no longer drill into a customer detail.
      // A future pass can switch this to /clients/:id once the customer ↔
      // contact bridge is wired (different entities, different IDs today).
    },
  ],
  sidebar: [
    {
      type: 'InfoCard',
      title: 'Dates',
      query: {
        graph: {
          entity: 'customerGroup',
          fields: ['created_at', 'updated_at'],
        },
      },
      fields: [
        { key: 'created_at', label: 'Created', display: 'date' },
        { key: 'updated_at', label: 'Updated', display: 'date' },
      ],
    },
  ],
})
