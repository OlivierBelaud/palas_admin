import { definePage } from '@manta/dashboard-core'

export default definePage({
  header: { title: 'Customers', actions: ['create'] },
  main: [
    {
      type: 'DataTable',
      query: {
        graph: {
          entity: 'customer',
          fields: ['email', 'first_name', 'last_name', 'phone', 'has_account', 'created_at'],
          pagination: { limit: 20 },
        },
      },
      columns: [
        { key: 'email', label: 'Email', format: 'highlight', sortable: true },
        { key: 'first_name', label: 'First Name', sortable: true },
        { key: 'last_name', label: 'Last Name', sortable: true },
        { key: 'phone', label: 'Phone' },
        { key: 'has_account', label: 'Account', format: { type: 'badge', true: { label: 'Yes', color: 'green' }, false: { label: 'No', color: 'orange' } }, filterable: true },
        { key: 'created_at', label: 'Joined', format: 'date', sortable: true },
      ],
      searchable: true,
      navigateTo: '/customers/:id',
      rowActions: [
        { label: 'Edit', icon: 'Pencil', to: '/customers/:id/edit' },
        { label: 'Delete', icon: 'Trash2', action: 'delete', entity: 'customer', destructive: true },
      ],
    },
  ],
})
