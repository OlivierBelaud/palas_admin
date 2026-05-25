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
    {
      icon: 'Activity',
      label: 'Lifecycle',
      to: '/visitor-lifecycle',
      items: [{ label: 'Visitor stats', to: '/visitor-stats' }],
    },
  ],

  settings: [
    { icon: 'Settings', label: 'General', to: '/settings' },
    { icon: 'UserPlus', label: 'Users', to: '/settings/users' },
  ],

  ai: true,
})
