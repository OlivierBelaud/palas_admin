import type { PageSpec } from '@manta/dashboard-core'

/**
 * Page specs — compositions of data components.
 * Each page defines its layout, query, and component refs.
 */

type PageRecord = Record<string, PageSpec>

function p(spec: PageSpec): PageSpec {
  return spec
}

export const pages: PageRecord = {
  // ════════════════════════════════════════════════
  // LISTING PAGES
  // ════════════════════════════════════════════════

  'products/list': p({
    id: 'products/list',
    type: 'list',
    layout: 'single-column',
    route: '/products',
    query: { entity: 'product', list: true, pageSize: 20 },
    breadcrumb: { label: 'Products' },
    main: ['products-table'],
  }),

  'orders/list': p({
    id: 'orders/list',
    type: 'list',
    layout: 'single-column',
    route: '/orders',
    query: { entity: 'order', list: true, pageSize: 20 },
    breadcrumb: { label: 'Orders' },
    main: ['orders-table'],
  }),

  'customers/list': p({
    id: 'customers/list',
    type: 'list',
    layout: 'single-column',
    route: '/customers',
    query: { entity: 'customer', list: true, pageSize: 20 },
    breadcrumb: { label: 'Customers' },
    main: ['customers-table'],
  }),

  'inventory/list': p({
    id: 'inventory/list',
    type: 'list',
    layout: 'single-column',
    route: '/inventory',
    query: { entity: 'inventory_item', list: true, pageSize: 20 },
    breadcrumb: { label: 'Inventory' },
    main: ['inventory-table'],
  }),

  'price-lists/list': p({
    id: 'price-lists/list',
    type: 'list',
    layout: 'single-column',
    route: '/price-lists',
    query: { entity: 'price_list', list: true, pageSize: 20 },
    breadcrumb: { label: 'Price Lists' },
    main: ['price-lists-table'],
  }),

  'collections/list': p({
    id: 'collections/list',
    type: 'list',
    layout: 'single-column',
    route: '/collections',
    query: { entity: 'product_collection', list: true, pageSize: 20 },
    breadcrumb: { label: 'Collections' },
    main: ['collections-table'],
  }),

  'categories/list': p({
    id: 'categories/list',
    type: 'list',
    layout: 'single-column',
    route: '/categories',
    query: { entity: 'product_category', list: true },
    breadcrumb: { label: 'Categories' },
    main: ['categories-table'],
  }),

  'customer-groups/list': p({
    id: 'customer-groups/list',
    type: 'list',
    layout: 'single-column',
    route: '/customer-groups',
    query: { entity: 'customer_group', list: true, pageSize: 20 },
    breadcrumb: { label: 'Customer Groups' },
    main: ['customer-groups-table'],
  }),

  'promotions/list': p({
    id: 'promotions/list',
    type: 'list',
    layout: 'single-column',
    route: '/promotions',
    query: { entity: 'promotion', list: true, pageSize: 20 },
    breadcrumb: { label: 'Promotions' },
    main: ['promotions-table'],
  }),

  'campaigns/list': p({
    id: 'campaigns/list',
    type: 'list',
    layout: 'single-column',
    route: '/campaigns',
    query: { entity: 'campaign', list: true, pageSize: 20 },
    breadcrumb: { label: 'Campaigns' },
    main: ['campaigns-table'],
  }),

  'reservations/list': p({
    id: 'reservations/list',
    type: 'list',
    layout: 'single-column',
    route: '/reservations',
    query: { entity: 'reservation', list: true, pageSize: 20 },
    breadcrumb: { label: 'Reservations' },
    main: ['reservations-table'],
  }),

  'product-tags/list': p({
    id: 'product-tags/list',
    type: 'list',
    layout: 'single-column',
    route: '/product-tags',
    query: { entity: 'product_tag', list: true, pageSize: 20 },
    breadcrumb: { label: 'Product Tags' },
    main: ['product-tags-table'],
  }),

  'product-types/list': p({
    id: 'product-types/list',
    type: 'list',
    layout: 'single-column',
    route: '/product-types',
    query: { entity: 'product_type', list: true, pageSize: 20 },
    breadcrumb: { label: 'Product Types' },
    main: ['product-types-table'],
  }),

  // ════════════════════════════════════════════════
  // DETAIL PAGES
  // ════════════════════════════════════════════════

  'products/detail': p({
    id: 'products/detail',
    type: 'detail',
    layout: 'two-column',
    route: '/products/:id',
    query: {
      entity: 'product',
      id: { $state: '/route/params/id' },
      fields: '+variants,+options,+images,+sales_channels,+collection,+categories,+tags,+type',
    },
    breadcrumb: { label: 'Products', field: 'title' },
    main: ['products-general', 'products-media', 'products-options', 'products-variants'],
    sidebar: ['products-sales-channels', 'products-organization'],
  }),

  'product-variants/detail': p({
    id: 'product-variants/detail',
    type: 'detail',
    layout: 'two-column',
    route: '/products/:productId/variants/:id',
    query: {
      entity: 'product_variant',
      id: { $state: '/route/params/id' },
      fields: '+prices,+inventory_items,+product,+options',
    },
    breadcrumb: { label: 'Variants', field: 'title' },
    main: ['product-variants-general', 'product-variants-prices', 'product-variants-inventory'],
    sidebar: ['products-general'],
  }),

  'orders/detail': p({
    id: 'orders/detail',
    type: 'detail',
    layout: 'two-column',
    route: '/orders/:id',
    query: {
      entity: 'order',
      id: { $state: '/route/params/id' },
      fields: '+items,+customer,+shipping_address,+billing_address,+fulfillments,+payment_collections',
    },
    breadcrumb: { label: 'Orders', field: 'display_id' },
    main: ['orders-general', 'orders-summary', 'orders-payment', 'orders-fulfillment'],
    sidebar: ['orders-customer', 'orders-activity'],
  }),

  'customers/detail': p({
    id: 'customers/detail',
    type: 'detail',
    layout: 'two-column',
    route: '/customers/:id',
    query: {
      entity: 'customer',
      id: { $state: '/route/params/id' },
      fields: '+orders,+addresses,+groups',
    },
    breadcrumb: { label: 'Customers', field: 'email' },
    main: ['customers-general', 'customers-orders'],
    sidebar: ['customers-general'],
  }),

  'inventory/detail': p({
    id: 'inventory/detail',
    type: 'detail',
    layout: 'two-column',
    route: '/inventory/:id',
    query: {
      entity: 'inventory_item',
      id: { $state: '/route/params/id' },
      fields: '+location_levels,+reservations',
    },
    breadcrumb: { label: 'Inventory', field: 'title' },
    main: ['inventory-general', 'inventory-location-levels', 'inventory-reservations'],
    sidebar: ['inventory-general'],
  }),

  'price-lists/detail': p({
    id: 'price-lists/detail',
    type: 'detail',
    layout: 'two-column',
    route: '/price-lists/:id',
    query: {
      entity: 'price_list',
      id: { $state: '/route/params/id' },
    },
    breadcrumb: { label: 'Price Lists', field: 'title' },
    main: ['price-lists-general'],
    sidebar: ['price-lists-configuration'],
  }),

  'collections/detail': p({
    id: 'collections/detail',
    type: 'detail',
    layout: 'single-column',
    route: '/collections/:id',
    query: {
      entity: 'product_collection',
      id: { $state: '/route/params/id' },
      fields: '+products',
    },
    breadcrumb: { label: 'Collections', field: 'title' },
    main: ['collections-general', 'collections-products'],
  }),

  'categories/detail': p({
    id: 'categories/detail',
    type: 'detail',
    layout: 'two-column',
    route: '/categories/:id',
    query: {
      entity: 'product_category',
      id: { $state: '/route/params/id' },
      fields: '+products,+category_children,+parent_category',
    },
    breadcrumb: { label: 'Categories', field: 'name' },
    main: ['categories-general', 'categories-products'],
    sidebar: ['categories-general'],
  }),

  'customer-groups/detail': p({
    id: 'customer-groups/detail',
    type: 'detail',
    layout: 'single-column',
    route: '/customer-groups/:id',
    query: {
      entity: 'customer_group',
      id: { $state: '/route/params/id' },
      fields: '+customers',
    },
    breadcrumb: { label: 'Customer Groups', field: 'name' },
    main: ['customer-groups-general', 'customer-groups-customers'],
  }),

  'promotions/detail': p({
    id: 'promotions/detail',
    type: 'detail',
    layout: 'two-column',
    route: '/promotions/:id',
    query: {
      entity: 'promotion',
      id: { $state: '/route/params/id' },
      fields: '+rules,+campaign',
    },
    breadcrumb: { label: 'Promotions', field: 'code' },
    main: ['promotions-general', 'promotions-rules'],
    sidebar: ['promotions-configuration', 'promotions-campaign'],
  }),

  'campaigns/detail': p({
    id: 'campaigns/detail',
    type: 'detail',
    layout: 'two-column',
    route: '/campaigns/:id',
    query: {
      entity: 'campaign',
      id: { $state: '/route/params/id' },
      fields: '+promotions,+budget',
    },
    breadcrumb: { label: 'Campaigns', field: 'name' },
    main: ['campaigns-general', 'campaigns-promotions'],
    sidebar: ['campaigns-budget'],
  }),

  'reservations/detail': p({
    id: 'reservations/detail',
    type: 'detail',
    layout: 'two-column',
    route: '/reservations/:id',
    query: {
      entity: 'reservation',
      id: { $state: '/route/params/id' },
      fields: '+inventory_item,+location',
    },
    breadcrumb: { label: 'Reservations', field: 'description' },
    main: ['reservations-general'],
    sidebar: ['reservations-general'],
  }),

  'product-tags/detail': p({
    id: 'product-tags/detail',
    type: 'detail',
    layout: 'single-column',
    route: '/product-tags/:id',
    query: {
      entity: 'product_tag',
      id: { $state: '/route/params/id' },
      fields: '+products',
    },
    breadcrumb: { label: 'Product Tags', field: 'value' },
    main: ['product-tags-general', 'product-tags-products'],
  }),

  'product-types/detail': p({
    id: 'product-types/detail',
    type: 'detail',
    layout: 'single-column',
    route: '/product-types/:id',
    query: {
      entity: 'product_type',
      id: { $state: '/route/params/id' },
      fields: '+products',
    },
    breadcrumb: { label: 'Product Types', field: 'value' },
    main: ['product-types-general', 'product-types-products'],
  }),

  // ════════════════════════════════════════════════
  // SETTINGS — LISTING PAGES
  // ════════════════════════════════════════════════

  'shipping-profiles/list': p({
    id: 'shipping-profiles/list',
    type: 'list',
    layout: 'single-column',
    route: '/settings/shipping-profiles',
    query: { entity: 'shipping_profile', list: true },
    breadcrumb: { label: 'Shipping Profiles' },
    main: ['shipping-profiles-table'],
  }),

  'refund-reasons/list': p({
    id: 'refund-reasons/list',
    type: 'list',
    layout: 'single-column',
    route: '/settings/refund-reasons',
    query: { entity: 'refund_reason', list: true },
    breadcrumb: { label: 'Refund Reasons' },
    main: ['refund-reasons-table'],
  }),

  'shipping-option-types/list': p({
    id: 'shipping-option-types/list',
    type: 'list',
    layout: 'single-column',
    route: '/settings/locations/shipping-option-types',
    query: { entity: 'shipping_option_type', list: true },
    breadcrumb: { label: 'Shipping Option Types' },
    main: ['shipping-option-types-table'],
  }),

  'workflow-executions/list': p({
    id: 'workflow-executions/list',
    type: 'list',
    layout: 'single-column',
    route: '/settings/workflow-executions',
    query: { entity: 'workflow_execution', list: true },
    breadcrumb: { label: 'Workflow Executions' },
    main: ['workflow-executions-table'],
  }),

  'regions/list': p({
    id: 'regions/list',
    type: 'list',
    layout: 'single-column',
    route: '/settings/regions',
    query: { entity: 'region', list: true },
    breadcrumb: { label: 'Regions' },
    main: ['regions-table'],
  }),

  'users/list': p({
    id: 'users/list',
    type: 'list',
    layout: 'single-column',
    route: '/settings/users',
    query: { entity: 'user', list: true },
    breadcrumb: { label: 'Users' },
    main: ['users-table'],
  }),

  'sales-channels/list': p({
    id: 'sales-channels/list',
    type: 'list',
    layout: 'single-column',
    route: '/settings/sales-channels',
    query: { entity: 'sales_channel', list: true },
    breadcrumb: { label: 'Sales Channels' },
    main: ['sales-channels-table'],
  }),

  'locations/list': p({
    id: 'locations/list',
    type: 'list',
    layout: 'single-column',
    route: '/settings/locations',
    query: { entity: 'stock_location', list: true },
    breadcrumb: { label: 'Locations' },
    main: ['locations-table'],
  }),

  'tax-regions/list': p({
    id: 'tax-regions/list',
    type: 'list',
    layout: 'single-column',
    route: '/settings/tax-regions',
    query: { entity: 'tax_region', list: true },
    breadcrumb: { label: 'Tax Regions' },
    main: ['tax-regions-table'],
  }),

  'return-reasons/list': p({
    id: 'return-reasons/list',
    type: 'list',
    layout: 'single-column',
    route: '/settings/return-reasons',
    query: { entity: 'return_reason', list: true },
    breadcrumb: { label: 'Return Reasons' },
    main: ['return-reasons-table'],
  }),

  'api-keys/list': p({
    id: 'api-keys/list',
    type: 'list',
    layout: 'single-column',
    route: '/settings/api-key-management',
    query: { entity: 'api_key', list: true },
    breadcrumb: { label: 'API Keys' },
    main: ['api-keys-table'],
  }),

  'translations/list': p({
    id: 'translations/list',
    type: 'list',
    layout: 'single-column',
    route: '/settings/translations',
    query: { entity: 'translation', list: true },
    breadcrumb: { label: 'Translations' },
    main: ['translations-table'],
  }),

  // ════════════════════════════════════════════════
  // SETTINGS — DETAIL PAGES
  // ════════════════════════════════════════════════

  'shipping-profiles/detail': p({
    id: 'shipping-profiles/detail',
    type: 'detail',
    layout: 'single-column',
    route: '/settings/shipping-profiles/:id',
    query: {
      entity: 'shipping_profile',
      id: { $state: '/route/params/id' },
    },
    breadcrumb: { label: 'Shipping Profiles', field: 'name' },
    main: ['shipping-profiles-general'],
  }),

  'shipping-option-types/detail': p({
    id: 'shipping-option-types/detail',
    type: 'detail',
    layout: 'single-column',
    route: '/settings/locations/shipping-option-types/:id',
    query: {
      entity: 'shipping_option_type',
      id: { $state: '/route/params/id' },
    },
    breadcrumb: { label: 'Shipping Option Types', field: 'label' },
    main: ['shipping-option-types-general'],
  }),

  'workflow-executions/detail': p({
    id: 'workflow-executions/detail',
    type: 'detail',
    layout: 'single-column',
    route: '/settings/workflow-executions/:id',
    query: {
      entity: 'workflow_execution',
      id: { $state: '/route/params/id' },
    },
    breadcrumb: { label: 'Workflow Executions', field: 'workflow_id' },
    main: ['workflow-executions-general', 'workflow-executions-timeline'],
  }),

  'regions/detail': p({
    id: 'regions/detail',
    type: 'detail',
    layout: 'single-column',
    route: '/settings/regions/:id',
    query: {
      entity: 'region',
      id: { $state: '/route/params/id' },
      fields: '+countries,+payment_providers',
    },
    breadcrumb: { label: 'Regions', field: 'name' },
    main: ['regions-general', 'regions-countries'],
  }),

  'users/detail': p({
    id: 'users/detail',
    type: 'detail',
    layout: 'single-column',
    route: '/settings/users/:id',
    query: {
      entity: 'user',
      id: { $state: '/route/params/id' },
    },
    breadcrumb: { label: 'Users', field: 'email' },
    main: ['users-general'],
  }),

  'sales-channels/detail': p({
    id: 'sales-channels/detail',
    type: 'detail',
    layout: 'single-column',
    route: '/settings/sales-channels/:id',
    query: {
      entity: 'sales_channel',
      id: { $state: '/route/params/id' },
      fields: '+products',
    },
    breadcrumb: { label: 'Sales Channels', field: 'name' },
    main: ['sales-channels-general', 'sales-channels-products'],
  }),

  'locations/detail': p({
    id: 'locations/detail',
    type: 'detail',
    layout: 'single-column',
    route: '/settings/locations/:id',
    query: {
      entity: 'stock_location',
      id: { $state: '/route/params/id' },
      fields: '+fulfillment_sets,+sales_channels',
    },
    breadcrumb: { label: 'Locations', field: 'name' },
    main: ['locations-general', 'locations-fulfillment-sets'],
  }),

  'tax-regions/detail': p({
    id: 'tax-regions/detail',
    type: 'detail',
    layout: 'single-column',
    route: '/settings/tax-regions/:id',
    query: {
      entity: 'tax_region',
      id: { $state: '/route/params/id' },
      fields: '+tax_rates,+provinces',
    },
    breadcrumb: { label: 'Tax Regions', field: 'country_code' },
    main: ['tax-regions-general', 'tax-regions-tax-rates', 'tax-regions-provinces'],
  }),

  'api-keys/detail': p({
    id: 'api-keys/detail',
    type: 'detail',
    layout: 'single-column',
    route: '/settings/api-key-management/:id',
    query: {
      entity: 'api_key',
      id: { $state: '/route/params/id' },
      fields: '+sales_channels',
    },
    breadcrumb: { label: 'API Keys', field: 'title' },
    main: ['api-keys-general', 'api-keys-sales-channels'],
  }),

  // ════════════════════════════════════════════════
  // TOP-LEVEL DETAIL PAGES
  // ════════════════════════════════════════════════

  'profile/detail': p({
    id: 'profile/detail',
    type: 'detail',
    layout: 'single-column',
    route: '/profile',
    query: {
      entity: 'user',
      id: { $state: '/auth/user/id' },
    },
    breadcrumb: { label: 'Profile' },
    main: ['profile-general'],
  }),

  'store/detail': p({
    id: 'store/detail',
    type: 'detail',
    layout: 'single-column',
    route: '/store',
    query: {
      entity: 'store',
      id: { $state: '/store/id' },
      fields: '+supported_currencies',
    },
    breadcrumb: { label: 'Store' },
    main: ['store-general', 'store-currencies'],
  }),
}
