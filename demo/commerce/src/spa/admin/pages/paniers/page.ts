import { definePage } from '@manta/dashboard-core'

export default definePage({
  header: {
    title: 'Paniers',
    actions: [
      { label: 'Consolider', command: '/api/cart-tracking/consolidate' },
      { label: 'Purger paniers vides', command: '/api/cart-tracking/purge-empty', destructive: true },
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
        { label: 'CA réalisé', key: 'total_revenue', format: 'number' },
        { label: 'Panier moyen', key: 'avg_cart_value', format: 'number' },
        { label: 'CA perdu (abandons)', key: 'abandoned_revenue', format: 'number' },
      ],
    },
    {
      type: 'DataTable',
      title: 'Tous les paniers',
      query: { name: 'cart-list' },
      columns: [
        { key: 'client', label: 'Client', format: 'highlight' },
        { key: 'montant', label: 'Montant', sortable: true },
        { key: 'item_count', label: 'Articles', format: 'number' },
        {
          key: 'status',
          label: 'Statut',
          format: {
            type: 'badge',
            values: {
              active: 'blue',
              cart_abandoned: 'orange',
              checkout_abandoned: 'orange',
              payment_abandoned: 'red',
              completed: 'green',
            },
          },
          filterable: ['active', 'cart_abandoned', 'checkout_abandoned', 'payment_abandoned', 'completed'],
        },
        {
          key: 'highest_stage',
          label: 'Étape max',
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
          filterable: ['cart', 'checkout_started', 'checkout_engaged', 'payment_attempted', 'completed'],
        },
        { key: 'last_action', label: 'Dernière action' },
        {
          key: 'last_action_at',
          label: 'Date',
          format: { type: 'date', format: 'long' },
          sortable: true,
        },
        { key: 'duree', label: 'Durée' },
      ],
      searchable: true,
      navigateTo: '/paniers/:id',
    },
  ],
})
