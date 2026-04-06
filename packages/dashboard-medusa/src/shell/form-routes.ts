/**
 * Form/modal child routes — imported from original Medusa dashboard source.
 *
 * In the original Medusa dashboard, clicking "Edit" navigates to a child route
 * (e.g. /orders/:id/email) which renders a RouteDrawer modal on top of the
 * detail page via React Router's <Outlet />.
 *
 * These routes are lazy-loaded from the Medusa source using the @medusa-routes
 * Vite alias. The alias must be configured in the demo's vite config:
 *
 *   resolve: {
 *     alias: {
 *       '@medusa-routes': resolve(__dirname, '../../sources/medusa-repo/packages/admin/dashboard/src/routes')
 *     }
 *   }
 *
 * Each form route exports { Component } which is a React component that renders
 * a RouteDrawer or RouteModal.
 */

import type { RouteObject } from 'react-router-dom'

// ──────────────────────────────────────────────
// Helper — creates a lazy route from Medusa source
// ──────────────────────────────────────────────

type FormRouteMap = Record<string, RouteObject[]>

// ──────────────────────────────────────────────
// Form routes by parent detail route path
// Key = the detail route path (e.g. "/products/:id")
// Value = array of child RouteObjects
// ──────────────────────────────────────────────

export const formRoutes: FormRouteMap = {
  // ════════════════════════════════════════════════
  // PRODUCTS
  // ════════════════════════════════════════════════
  '/products/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/products/product-edit') },
    { path: 'sales-channels', lazy: () => import('@medusa-routes/products/product-sales-channels') },
    { path: 'attributes', lazy: () => import('@medusa-routes/products/product-attributes') },
    { path: 'organization', lazy: () => import('@medusa-routes/products/product-organization') },
    { path: 'shipping-profile', lazy: () => import('@medusa-routes/products/product-shipping-profile') },
    { path: 'media', lazy: () => import('@medusa-routes/products/product-media') },
    { path: 'prices', lazy: () => import('@medusa-routes/products/product-prices') },
    { path: 'options/create', lazy: () => import('@medusa-routes/products/product-create-option') },
    { path: 'options/:option_id/edit', lazy: () => import('@medusa-routes/products/product-edit-option') },
    { path: 'variants/create', lazy: () => import('@medusa-routes/products/product-create-variant') },
    { path: 'stock', lazy: () => import('@medusa-routes/products/product-stock') },
    { path: 'metadata/edit', lazy: () => import('@medusa-routes/products/product-metadata') },
  ],

  // ════════════════════════════════════════════════
  // PRODUCT VARIANTS
  // ════════════════════════════════════════════════
  '/products/:productId/variants/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/product-variants/product-variant-edit') },
    { path: 'prices', lazy: () => import('@medusa-routes/products/product-prices') },
    {
      path: 'manage-items',
      lazy: () => import('@medusa-routes/product-variants/product-variant-manage-inventory-items'),
    },
    { path: 'media', lazy: () => import('@medusa-routes/product-variants/product-variant-media') },
    { path: 'metadata/edit', lazy: () => import('@medusa-routes/product-variants/product-variant-metadata') },
  ],

  // ════════════════════════════════════════════════
  // ORDERS
  // ════════════════════════════════════════════════
  '/orders/:id': [
    { path: 'fulfillment', lazy: () => import('@medusa-routes/orders/order-create-fulfillment') },
    { path: 'allocate-items', lazy: () => import('@medusa-routes/orders/order-allocate-items') },
    { path: ':f_id/create-shipment', lazy: () => import('@medusa-routes/orders/order-create-shipment') },
    { path: 'returns', lazy: () => import('@medusa-routes/orders/order-create-return') },
    { path: 'returns/:return_id/receive', lazy: () => import('@medusa-routes/orders/order-receive-return') },
    { path: 'claims', lazy: () => import('@medusa-routes/orders/order-create-claim') },
    { path: 'exchanges', lazy: () => import('@medusa-routes/orders/order-create-exchange') },
    { path: 'edits', lazy: () => import('@medusa-routes/orders/order-create-edit') },
    { path: 'refund', lazy: () => import('@medusa-routes/orders/order-create-refund') },
    { path: 'transfer', lazy: () => import('@medusa-routes/orders/order-request-transfer') },
    { path: 'email', lazy: () => import('@medusa-routes/orders/order-edit-email') },
    { path: 'shipping-address', lazy: () => import('@medusa-routes/orders/order-edit-shipping-address') },
    { path: 'billing-address', lazy: () => import('@medusa-routes/orders/order-edit-billing-address') },
    { path: 'metadata/edit', lazy: () => import('@medusa-routes/orders/order-metadata') },
  ],

  // ════════════════════════════════════════════════
  // CUSTOMERS
  // ════════════════════════════════════════════════
  '/customers/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/customers/customer-edit') },
    { path: 'create-address', lazy: () => import('@medusa-routes/customers/customer-create-address') },
    { path: 'add-customer-groups', lazy: () => import('@medusa-routes/customers/customers-add-customer-group') },
    { path: 'metadata/edit', lazy: () => import('@medusa-routes/customers/customer-metadata') },
  ],

  // ════════════════════════════════════════════════
  // COLLECTIONS
  // ════════════════════════════════════════════════
  '/collections/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/collections/collection-edit') },
    { path: 'products', lazy: () => import('@medusa-routes/collections/collection-add-products') },
    { path: 'metadata/edit', lazy: () => import('@medusa-routes/collections/collection-metadata') },
  ],

  // ════════════════════════════════════════════════
  // CATEGORIES
  // ════════════════════════════════════════════════
  '/categories/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/categories/category-edit') },
    { path: 'products', lazy: () => import('@medusa-routes/categories/category-products') },
    { path: 'organize', lazy: () => import('@medusa-routes/categories/category-organize') },
    { path: 'metadata/edit', lazy: () => import('@medusa-routes/categories/categories-metadata') },
  ],

  // ════════════════════════════════════════════════
  // CUSTOMER GROUPS
  // ════════════════════════════════════════════════
  '/customer-groups/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/customer-groups/customer-group-edit') },
    { path: 'add-customers', lazy: () => import('@medusa-routes/customer-groups/customer-group-add-customers') },
    { path: 'metadata/edit', lazy: () => import('@medusa-routes/customer-groups/customer-group-metadata') },
  ],

  // ════════════════════════════════════════════════
  // PROMOTIONS
  // ════════════════════════════════════════════════
  '/promotions/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/promotions/promotion-edit-details') },
    { path: 'add-to-campaign', lazy: () => import('@medusa-routes/promotions/promotion-add-campaign') },
    { path: ':ruleType/edit', lazy: () => import('@medusa-routes/promotions/common/edit-rules') },
  ],

  // ════════════════════════════════════════════════
  // CAMPAIGNS
  // ════════════════════════════════════════════════
  '/campaigns/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/campaigns/campaign-edit') },
    { path: 'configuration', lazy: () => import('@medusa-routes/campaigns/campaign-configuration') },
    { path: 'edit-budget', lazy: () => import('@medusa-routes/campaigns/campaign-budget-edit') },
    { path: 'add-promotions', lazy: () => import('@medusa-routes/campaigns/add-campaign-promotions') },
  ],

  // ════════════════════════════════════════════════
  // PRICE LISTS
  // ════════════════════════════════════════════════
  '/price-lists/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/price-lists/price-list-edit') },
    { path: 'configuration', lazy: () => import('@medusa-routes/price-lists/price-list-configuration') },
    { path: 'products/add', lazy: () => import('@medusa-routes/price-lists/price-list-prices-add') },
    { path: 'products/edit', lazy: () => import('@medusa-routes/price-lists/price-list-prices-edit') },
  ],

  // ════════════════════════════════════════════════
  // INVENTORY
  // ════════════════════════════════════════════════
  '/inventory/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/inventory/inventory-detail/components/edit-inventory-item') },
    {
      path: 'attributes',
      lazy: () => import('@medusa-routes/inventory/inventory-detail/components/edit-inventory-item-attributes'),
    },
    { path: 'metadata/edit', lazy: () => import('@medusa-routes/inventory/inventory-metadata') },
    { path: 'locations', lazy: () => import('@medusa-routes/inventory/inventory-detail/components/manage-locations') },
    {
      path: 'locations/:location_id',
      lazy: () => import('@medusa-routes/inventory/inventory-detail/components/adjust-inventory'),
    },
  ],

  // ════════════════════════════════════════════════
  // RESERVATIONS
  // ════════════════════════════════════════════════
  '/reservations/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/reservations/reservation-detail/components/edit-reservation') },
    { path: 'metadata/edit', lazy: () => import('@medusa-routes/reservations/reservation-metadata') },
  ],

  // ════════════════════════════════════════════════
  // PRODUCT TAGS
  // ════════════════════════════════════════════════
  '/product-tags/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/product-tags/product-tag-edit') },
    { path: 'metadata/edit', lazy: () => import('@medusa-routes/product-tags/product-tag-metadata') },
  ],

  // ════════════════════════════════════════════════
  // PRODUCT TYPES
  // ════════════════════════════════════════════════
  '/product-types/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/product-types/product-type-edit') },
    { path: 'metadata/edit', lazy: () => import('@medusa-routes/product-types/product-type-metadata') },
  ],

  // ════════════════════════════════════════════════
  // SETTINGS — REGIONS
  // ════════════════════════════════════════════════
  '/settings/regions/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/regions/region-edit') },
    { path: 'countries/add', lazy: () => import('@medusa-routes/regions/region-add-countries') },
    { path: 'metadata/edit', lazy: () => import('@medusa-routes/regions/region-metadata') },
  ],

  // ════════════════════════════════════════════════
  // SETTINGS — USERS
  // ════════════════════════════════════════════════
  '/settings/users/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/users/user-edit') },
    { path: 'metadata/edit', lazy: () => import('@medusa-routes/users/user-metadata') },
  ],

  // ════════════════════════════════════════════════
  // SETTINGS — SALES CHANNELS
  // ════════════════════════════════════════════════
  '/settings/sales-channels/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/sales-channels/sales-channel-edit') },
    { path: 'add-products', lazy: () => import('@medusa-routes/sales-channels/sales-channel-add-products') },
  ],

  // ════════════════════════════════════════════════
  // SETTINGS — LOCATIONS
  // ════════════════════════════════════════════════
  '/settings/locations/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/locations/location-edit') },
    { path: 'sales-channels', lazy: () => import('@medusa-routes/locations/location-sales-channels') },
    { path: 'fulfillment-providers', lazy: () => import('@medusa-routes/locations/location-fulfillment-providers') },
    {
      path: 'fulfillment-set/:fset_id/service-zones/create',
      lazy: () => import('@medusa-routes/locations/location-service-zone-create'),
    },
    {
      path: 'fulfillment-set/:fset_id/service-zone/:zone_id/edit',
      lazy: () => import('@medusa-routes/locations/location-service-zone-edit'),
    },
    {
      path: 'fulfillment-set/:fset_id/service-zone/:zone_id/areas',
      lazy: () => import('@medusa-routes/locations/location-service-zone-manage-areas'),
    },
    {
      path: 'fulfillment-set/:fset_id/service-zone/:zone_id/shipping-option/create',
      lazy: () => import('@medusa-routes/locations/location-service-zone-shipping-option-create'),
    },
    {
      path: 'fulfillment-set/:fset_id/service-zone/:zone_id/shipping-option/:so_id/edit',
      lazy: () => import('@medusa-routes/locations/location-service-zone-shipping-option-edit'),
    },
    {
      path: 'fulfillment-set/:fset_id/service-zone/:zone_id/shipping-option/:so_id/pricing',
      lazy: () => import('@medusa-routes/locations/location-service-zone-shipping-option-pricing'),
    },
  ],

  // ════════════════════════════════════════════════
  // SETTINGS — TAX REGIONS
  // ════════════════════════════════════════════════
  '/settings/tax-regions/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/tax-regions/tax-region-edit') },
    { path: 'provinces/create', lazy: () => import('@medusa-routes/tax-regions/tax-region-province-create') },
    { path: 'overrides/create', lazy: () => import('@medusa-routes/tax-regions/tax-region-tax-override-create') },
    {
      path: 'overrides/:tax_rate_id/edit',
      lazy: () => import('@medusa-routes/tax-regions/tax-region-tax-override-edit'),
    },
    { path: 'tax-rates/create', lazy: () => import('@medusa-routes/tax-regions/tax-region-tax-rate-create') },
    { path: 'tax-rates/:tax_rate_id/edit', lazy: () => import('@medusa-routes/tax-regions/tax-region-tax-rate-edit') },
    {
      path: 'provinces/:province_id',
      children: [
        { path: 'tax-rates/create', lazy: () => import('@medusa-routes/tax-regions/tax-region-tax-rate-create') },
        {
          path: 'tax-rates/:tax_rate_id/edit',
          lazy: () => import('@medusa-routes/tax-regions/tax-region-tax-rate-edit'),
        },
        { path: 'overrides/create', lazy: () => import('@medusa-routes/tax-regions/tax-region-tax-override-create') },
        {
          path: 'overrides/:tax_rate_id/edit',
          lazy: () => import('@medusa-routes/tax-regions/tax-region-tax-override-edit'),
        },
      ],
    },
  ],

  // ════════════════════════════════════════════════
  // SETTINGS — API KEYS
  // ════════════════════════════════════════════════
  '/settings/api-key-management/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/api-key-management/api-key-management-edit') },
    {
      path: 'sales-channels',
      lazy: () => import('@medusa-routes/api-key-management/api-key-management-sales-channels'),
    },
  ],

  // ════════════════════════════════════════════════
  // SETTINGS — RETURN REASONS
  // ════════════════════════════════════════════════
  '/settings/return-reasons/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/return-reasons/return-reason-edit') },
  ],

  // ════════════════════════════════════════════════
  // SETTINGS — REFUND REASONS
  // ════════════════════════════════════════════════
  '/settings/refund-reasons/:id': [
    { path: 'edit', lazy: () => import('@medusa-routes/refund-reasons/refund-reason-edit') },
  ],
}
