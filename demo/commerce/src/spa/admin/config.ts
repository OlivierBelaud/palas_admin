import { defineSpa } from '@manta/dashboard-core'

export default defineSpa({
  title: 'Commerce Admin',
  favicon: '/favicon.webp',

  navigation: [
    {
      icon: 'BarChart3',
      label: 'Activité du site',
      to: '/activite-site',
    },
    {
      icon: 'ShoppingCart',
      label: 'Paniers',
      to: '/paniers',
      items: [
        { label: 'Paniers abandonnés', to: '/paniers-abandonnes' },
        { label: 'Analyse tracking', to: '/analyse-tracking' },
      ],
    },
    {
      icon: 'Users',
      label: 'Customers',
      to: '/customers',
      items: [{ label: 'Customer Groups', to: '/customer-groups' }],
    },
  ],

  settings: [{ icon: 'Settings', label: 'General', to: '/settings' }],

  ai: true,
})
