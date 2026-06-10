import { definePage } from '@mantajs/dashboard'

export default definePage({
  header: {
    title: 'Paniers',
    actions: [
      { label: 'Consolider', command: '/api/cart-tracking/consolidate' },
      { label: 'Auditer carts', command: 'auditCartSnapshots' },
      { label: 'Tester réparation carts', command: 'repairCartSnapshots' },
      { label: 'Réparer carts', command: 'repairCartSnapshotsApply', destructive: true },
      { label: 'Purger paniers vides', command: '/api/cart-tracking/purge-empty', destructive: true },
      { label: 'Reconstruire depuis PostHog', command: '/api/admin/command/rebuildCarts', destructive: true },
    ],
  },
  main: [
    {
      type: 'StatsCard',
      query: { name: 'cart-stats' },
      metrics: [
        { label: 'Paniers (30j)', key: 'total_carts', format: 'number' },
        { label: 'En cours', key: 'active', format: 'number' },
        { label: 'Complétés', key: 'completed', format: 'number' },
        { label: 'Paniers abandonnés', key: 'cart_abandoned', format: 'number' },
        { label: 'Checkouts abandonnés', key: 'checkout_abandoned', format: 'number' },
        { label: 'Paiements échoués', key: 'payment_abandoned', format: 'number' },
        { label: 'Morts (>7j)', key: 'dead', format: 'number' },
        { label: 'CA réalisé', key: 'total_revenue', format: 'number' },
        { label: 'Panier moyen', key: 'avg_cart_value', format: 'number' },
        { label: 'CA perdu (abandons)', key: 'abandoned_revenue', format: 'number' },
      ],
    },
    {
      type: 'DataTable',
      title: 'Tous les paniers',
      pageSize: 10,
      query: {
        graph: {
          entity: 'cart',
          sort: { field: 'last_action_at', order: 'desc' },
          pagination: { limit: 10 },
        },
      },
      columns: [
        { key: 'email', label: 'Client', format: 'highlight' },
        { key: 'total_price', label: 'Montant', format: 'currency', sortable: true },
        { key: 'item_count', label: 'Articles', format: 'number' },
        {
          key: 'highest_stage',
          label: 'Étape max',
          filterable: ['cart', 'checkout_started', 'checkout_engaged', 'payment_attempted', 'completed'],
          format: {
            type: 'badge',
            values: {
              cart: 'gray',
              checkout_started: 'blue',
              checkout_engaged: 'purple',
              payment_attempted: 'orange',
              completed: 'green',
            },
          },
        },
        { key: 'last_action', label: 'Dernière action' },
        {
          key: 'last_action_at',
          label: 'Date',
          format: { type: 'date', format: 'long' },
          sortable: true,
        },
        {
          key: 'abandon_notified_source',
          label: 'Relance',
          format: {
            type: 'badge',
            values: {
              manta: 'green',
              klaviyo: 'blue',
            },
          },
        },
        {
          key: 'abandon_notified_at',
          label: 'Relancé le',
          format: { type: 'date', format: 'relative' },
          sortable: true,
        },
      ],
      filters: [
        {
          key: 'email',
          label: 'Client',
          type: 'select',
          options: [
            { label: 'Défini', value: '__notnull' },
            { label: 'Anonyme', value: '__null' },
          ],
        },
        {
          key: 'abandon_notified_source',
          label: 'Relance',
          type: 'select',
          options: [
            { label: 'Envoyée par Manta', value: 'manta' },
            { label: 'Envoyée par Klaviyo', value: 'klaviyo' },
            { label: 'Pas relancé', value: '__null' },
          ],
        },
      ],
      searchable: true,
      navigateTo: '/paniers/:id',
    },
  ],
})
