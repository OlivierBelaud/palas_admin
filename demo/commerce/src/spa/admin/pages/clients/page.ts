import { definePage } from '@manta/dashboard-core'

export default definePage({
  header: {
    title: 'Clients',
    actions: [
      { label: 'Tester consolidation', command: 'reconcileContactSnapshots' },
      { label: 'Réparer contacts', command: 'reconcileContactSnapshotsApply', destructive: true },
    ],
  },
  main: [
    {
      type: 'DataTable',
      title: 'Tous les clients',
      pageSize: 10,
      query: {
        graph: {
          entity: 'contact',
          sort: { field: 'last_activity_at', order: 'desc' },
          pagination: { limit: 10 },
        },
      },
      columns: [
        { key: 'email', label: 'Email', format: 'highlight', sortable: true },
        { key: 'first_name', label: 'Prénom' },
        { key: 'last_name', label: 'Nom' },
        { key: 'orders_count', label: 'Commandes', format: 'number', sortable: true },
        { key: 'total_spent', label: 'CA', format: 'currency', sortable: true },
        {
          key: 'last_order_at',
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
      // Segment chip via last_order_at presence: Customer = au moins une commande,
      // Lead = email connu mais aucune commande encore. orders_count est non
      // nullable (default 0) donc on s'appuie sur last_order_at qui est nullable.
      filters: [
        {
          key: 'last_order_at',
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
