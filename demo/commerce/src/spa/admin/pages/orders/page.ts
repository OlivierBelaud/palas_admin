import { definePage } from '@mantajs/dashboard'

export default definePage({
  header: {
    title: 'Commandes',
    actions: [
      { label: 'Tester refresh orders', command: 'backfillOrderSnapshots' },
      { label: 'Réparer orders (lot)', command: 'backfillOrderSnapshotsApply', destructive: true },
      { label: 'Resync analytics orders', command: 'resyncOrderAnalyticsApply', destructive: true },
    ],
  },
  main: [
    {
      type: 'DataTable',
      title: 'Toutes les commandes',
      pageSize: 10,
      query: {
        graph: {
          entity: 'order',
          sort: { field: 'placed_at', order: 'desc' },
          pagination: { limit: 10 },
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
        { key: 'sales_channel', label: 'Canal', format: 'badge' },
        { key: 'include_in_ecommerce_analytics', label: 'Analytics e-com', format: 'boolean' },
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
