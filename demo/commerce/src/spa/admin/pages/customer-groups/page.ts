import { definePage } from '@manta/dashboard-core'

export default definePage({
  header: { title: 'Customer Groups', actions: ['create'] },
  main: [
    {
      type: 'DataTable',
      query: {
        graph: {
          entity: 'customerGroup',
          fields: ['name', 'created_at', 'customers'],
          pagination: { limit: 20 },
        },
      },
      columns: [
        { key: 'name', label: 'Name', format: 'highlight' },
        { key: 'customers', label: 'Customers', type: 'count' },
        { key: 'created_at', label: 'Created', format: 'date' },
      ],
      searchable: true,
      navigateTo: '/customer-groups/:id',
      rowActions: [
        { label: 'Edit', icon: 'Pencil', to: '/customer-groups/:id/edit' },
        { label: 'Delete', icon: 'Trash2', action: 'delete', entity: 'customerGroup', destructive: true },
      ],
    },
  ],
})
