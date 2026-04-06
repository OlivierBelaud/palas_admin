import {
  BuildingStorefront,
  Buildings,
  CogSixTooth,
  CurrencyDollar,
  ReceiptPercent,
  ShoppingCart,
  Sparkles,
  SquaresPlus,
  Tag,
  Users,
} from '@medusajs/icons'
import React from 'react'

export const medusaNavigation = [
  {
    icon: React.createElement(ShoppingCart),
    label: 'Orders',
    to: '/orders',
    items: [],
  },
  {
    icon: React.createElement(Tag),
    label: 'Products',
    to: '/products',
    items: [
      { label: 'Collections', to: '/collections' },
      { label: 'Categories', to: '/categories' },
    ],
  },
  {
    icon: React.createElement(Buildings),
    label: 'Inventory',
    to: '/inventory',
    items: [{ label: 'Reservations', to: '/reservations' }],
  },
  {
    icon: React.createElement(Users),
    label: 'Customers',
    to: '/customers',
    items: [{ label: 'Customer Groups', to: '/customer-groups' }],
  },
  {
    icon: React.createElement(ReceiptPercent),
    label: 'Promotions',
    to: '/promotions',
    items: [{ label: 'Campaigns', to: '/campaigns' }],
  },
  {
    icon: React.createElement(CurrencyDollar),
    label: 'Price Lists',
    to: '/price-lists',
  },
]

export const medusaIconMap: Record<string, React.ReactElement> = {
  ShoppingCart: React.createElement(ShoppingCart),
  Tag: React.createElement(Tag),
  Buildings: React.createElement(Buildings),
  Users: React.createElement(Users),
  ReceiptPercent: React.createElement(ReceiptPercent),
  CurrencyDollar: React.createElement(CurrencyDollar),
  CogSixTooth: React.createElement(CogSixTooth),
  BuildingStorefront: React.createElement(BuildingStorefront),
  Sparkles: React.createElement(Sparkles),
  SquaresPlus: React.createElement(SquaresPlus),
}
