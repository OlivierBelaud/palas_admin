import { defineSpa } from '@manta/dashboard-core'

export default defineSpa({
  title: 'CRM Shopify',
  favicon: '/favicon.webp',

  navigation: [
    {
      icon: 'ShoppingCart',
      label: 'Paniers',
      to: '/paniers',
      items: [{ label: 'Paniers abandonnés', to: '/paniers-abandonnes' }],
    },
    {
      icon: 'Receipt',
      label: 'Commandes',
      to: '/orders',
    },
    {
      icon: 'Users',
      label: 'Clients',
      to: '/clients',
    },
    {
      icon: 'BarChart3',
      label: 'Charts lab',
      to: '/charts-lab',
    },
  ],

  settings: [{ icon: 'Settings', label: 'General', to: '/settings' }],

  ai: true,
})
