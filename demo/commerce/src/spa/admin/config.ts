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
      icon: 'Package',
      label: 'Commandes',
      to: '/orders',
    },
    {
      icon: 'Users',
      label: 'Clients',
      to: '/clients',
    },
    {
      icon: 'UserCog',
      label: 'Customer Groups',
      to: '/customer-groups',
    },
  ],

  settings: [{ icon: 'Settings', label: 'General', to: '/settings' }],

  ai: true,
})
