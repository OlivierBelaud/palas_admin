import { definePage } from '@manta/dashboard-core'

export default definePage({
  header: {
    title: 'Commandes',
  },
  main: [
    {
      type: 'DataTable',
      title: 'Toutes les commandes',
      pageSize: 15,
      query: {
        graph: {
          entity: 'order',
          sort: { field: 'placed_at', order: 'desc' },
          pagination: { limit: 15 },
        },
      },
      columns: [
        { key: 'order_number', label: 'Commande', format: 'highlight' },
        { key: 'email', label: 'Email' },
        {
          key: 'status',
          label: 'Statut',
          filterable: ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded'],
          format: {
            type: 'badge',
            values: {
              pending: 'gray',
              paid: 'blue',
              fulfilled: 'green',
              cancelled: 'red',
              refunded: 'orange',
            },
          },
        },
        { key: 'total_price', label: 'Total', format: 'currency', sortable: true },
        {
          key: 'placed_at',
          label: 'Date',
          format: { type: 'date', format: 'long' },
          sortable: true,
        },
        { key: 'fulfillment_status', label: 'Fulfillment', format: 'badge' },
      ],
      searchable: true,
      navigateTo: '/orders/:id',
    },
  ],
})
