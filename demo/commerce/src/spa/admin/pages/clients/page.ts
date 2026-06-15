import { definePage } from '@mantajs/dashboard'

export default definePage({
  header: {
    title: 'Clients',
    actions: [],
  },
  main: [
    {
      type: 'DataTable',
      title: 'Tous les clients',
      pageSize: 10,
      query: { name: 'contact-list' },
      columns: [
        { key: 'email', label: 'Email', format: 'highlight', sortable: true },
        { key: 'first_name', label: 'Prénom' },
        { key: 'last_name', label: 'Nom' },
        { key: 'live_orders_count', label: 'Commandes', format: 'number', sortable: true },
        { key: 'live_total_spent', label: 'CA', format: 'currency', sortable: true },
        {
          key: 'live_last_order_at',
          label: 'Dernière commande',
          format: { type: 'date', format: 'long' },
          sortable: true,
        },
        {
          key: 'last_activity_at',
          label: 'Dernière activité',
          format: { type: 'date', format: 'long' },
          sortable: true,
        },
        { key: 'country_code', label: 'Pays', format: 'badge' },
      ],
      // Segment chip via live_last_order_at presence: Customer = au moins une
      // commande dans `orders`; Lead = email connu mais aucune commande encore.
      filters: [
        {
          key: 'live_last_order_at',
          label: 'Segment',
          type: 'select',
          options: [
            { label: 'Customers', value: '__notnull' },
            { label: 'Leads', value: '__null' },
          ],
        },
      ],
      searchable: true,
      navigateTo: '/clients/:id',
    },
  ],
})
