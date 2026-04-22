import { definePage } from '@manta/dashboard-core'

export default definePage({
  header: {
    title: 'Analyse tracking',
  },
  main: [
    {
      type: 'DataTable',
      title: 'Couverture tri-canal',
      query: { name: 'tracking-coverage', input: { limit: 200, days: 30 } },
      columns: [
        { key: 'email', label: 'Email', format: 'highlight' },
        {
          key: 'activity_state',
          label: 'État (Palas)',
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
          key: 'palas',
          label: 'Palas',
          format: {
            type: 'badge',
            values: {
              active: 'blue',
              abandoned: 'orange',
              completed: 'green',
            },
          },
        },
        {
          key: 'shopify',
          label: 'Shopify',
          format: {
            type: 'badge',
            values: {
              order: 'green',
              abandoned: 'orange',
              customer: 'blue',
              none: 'gray',
            },
          },
        },
        { key: 'shopify_details', label: 'Détails Shopify' },
        {
          key: 'klaviyo',
          label: 'Klaviyo',
          format: {
            type: 'badge',
            values: {
              email_sent: 'green',
              profile: 'blue',
              none: 'gray',
            },
          },
        },
        { key: 'klaviyo_details', label: 'Détails Klaviyo' },
        { key: 'total_price', label: 'Montant', format: 'currency', sortable: true },
        {
          key: 'last_action_at',
          label: 'Dernière action',
          format: { type: 'date', format: 'long' },
          sortable: true,
        },
      ],
      searchable: true,
      navigateTo: '/paniers/:id',
    },
  ],
})
