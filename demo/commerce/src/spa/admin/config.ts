import { defineSpa } from '@manta/dashboard-core'

export default defineSpa({
  title: 'Commerce Admin',

  navigation: [
    {
      icon: 'BarChart3',
      label: "Activité du site",
      to: '/activite-site',
    },
    {
      icon: 'Users',
      label: 'Customers',
      to: '/customers',
      items: [
        { label: 'Customer Groups', to: '/customer-groups' },
      ],
    },
  ],

  settings: [
    { icon: 'Settings', label: 'General', to: '/settings' },
  ],

  ai: true,
})
