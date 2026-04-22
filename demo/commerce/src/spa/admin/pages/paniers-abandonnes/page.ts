import { definePage } from '@manta/dashboard-core'

export default definePage({
  header: {
    title: 'Paniers abandonnés',
  },
  main: [
    {
      type: 'DataTable',
      title: 'À récupérer',
      query: { name: 'abandoned-carts', input: { limit: 200, days: 30 } },
      columns: [
        { key: 'email', label: 'Client', format: 'highlight' },
        {
          key: 'activity_state',
          label: 'État',
          format: {
            type: 'badge',
            values: {
              browsing: 'blue',
              dormant: 'orange',
              dead: 'red',
              completed: 'green',
            },
          },
        },
        {
          key: 'recovery_category',
          label: 'Recovery',
          format: {
            type: 'badge',
            values: {
              recovered: 'green',
              pending_recovery: 'blue',
              assisted_dead: 'red',
              not_picked_up: 'gray',
            },
          },
        },
        {
          key: 'number_of_orders',
          label: 'Cmds passées',
          format: 'number',
          sortable: true,
        },
        { key: 'total_price', label: 'Montant', format: 'currency', sortable: true },
        { key: 'item_count', label: 'Articles', format: 'number' },
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
        },
        {
          key: 'last_action_at',
          label: 'Dernière action',
          format: { type: 'date', format: 'long' },
          sortable: true,
        },
        {
          key: 'last_abandon_email_at',
          label: 'Dernier email abandon',
          format: { type: 'date', format: 'long' },
          sortable: true,
        },
      ],
      searchable: true,
      navigateTo: '/paniers/:id',
      // Fond plus foncé pour les clients qui avaient déjà commandé chez Palas
      // AVANT le cart affiché (≥2 orders si completed, ≥1 sinon).
      rowHighlight: { field: 'is_existing_customer' },
    },
  ],
})
