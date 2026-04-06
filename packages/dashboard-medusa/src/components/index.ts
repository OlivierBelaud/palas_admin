import type { DataComponent } from '@manta/dashboard-core'

/**
 * Data components — named instances of structural blocks.
 * Each component is an instance of a block type with specific props
 * matching its block schema.
 */

type ComponentRecord = Record<string, DataComponent>

// Helper to define a component with type safety on id
function c(id: string, type: string, props: Record<string, unknown>): DataComponent {
  return { id, type, props }
}

export const components: ComponentRecord = {
  // ════════════════════════════════════════════════
  // LISTING COMPONENTS (EntityTable / TreeList)
  // ════════════════════════════════════════════════

  'products-table': c('products-table', 'EntityTable', {
    heading: 'Products',
    pageActions: [
      { label: 'Export', to: '/products/export', variant: 'secondary' },
      { label: 'Import', to: '/products/import', variant: 'secondary' },
      { label: 'Create', to: '/products/create', variant: 'secondary' },
    ],
    columns: [
      { key: 'title', label: 'Product', type: 'thumbnail', thumbnailKey: 'thumbnail' },
      { key: 'collection.title', label: 'Collection' },
      { key: 'sales_channels', label: 'Sales Channels', type: 'list-count' },
      { key: 'variants', label: 'Variants', type: 'count' },
      { key: 'status', label: 'Status', type: 'badge' },
    ],
    searchable: true,
    filterable: true,
    pagination: true,
    navigateTo: '/products/:id',
    rowActions: [
      { label: 'Edit', icon: 'pencil', to: '/products/:id/edit' },
      { label: 'Delete', icon: 'trash', action: 'delete', destructive: true },
    ],
    orderBy: [
      { key: 'title', label: 'Title' },
      { key: 'created_at', label: 'Created at' },
      { key: 'updated_at', label: 'Updated at' },
    ],
    filters: [
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
          { label: 'Proposed', value: 'proposed' },
          { label: 'Rejected', value: 'rejected' },
        ],
      },
    ],
  }),

  'orders-table': c('orders-table', 'EntityTable', {
    heading: 'Orders',
    columns: [
      { key: 'display_id', label: 'Order', type: 'display-id' },
      { key: 'customer', label: 'Customer', type: 'customer-name' },
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'total', label: 'Total', type: 'currency' },
      { key: 'created_at', label: 'Date', type: 'date' },
    ],
    searchable: true,
    filterable: true,
    pagination: true,
    navigateTo: '/orders/:id',
    orderBy: [
      { key: 'created_at', label: 'Created at' },
      { key: 'updated_at', label: 'Updated at' },
    ],
  }),

  'customers-table': c('customers-table', 'EntityTable', {
    heading: 'Customers',
    pageActions: [{ label: 'Create', to: '/customers/create', variant: 'secondary' }],
    columns: [
      { key: 'name', label: 'Name', type: 'customer-name' },
      { key: 'email', label: 'Email' },
      { key: 'orders_count', label: 'Orders', type: 'number' },
      { key: 'created_at', label: 'Joined', type: 'date' },
    ],
    searchable: true,
    filterable: true,
    pagination: true,
    navigateTo: '/customers/:id',
    orderBy: [
      { key: 'created_at', label: 'Created at' },
      { key: 'has_account', label: 'Has account' },
    ],
  }),

  'inventory-table': c('inventory-table', 'EntityTable', {
    columns: [
      { key: 'sku', label: 'SKU' },
      { key: 'title', label: 'Title' },
      { key: 'stocked_quantity', label: 'In Stock', type: 'number' },
      { key: 'reserved_quantity', label: 'Reserved', type: 'number' },
    ],
    searchable: true,
    filterable: true,
    pagination: true,
    navigateTo: '/inventory/:id',
  }),

  'price-lists-table': c('price-lists-table', 'EntityTable', {
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'type', label: 'Type' },
      { key: 'prices_count', label: 'Prices', type: 'number' },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/price-lists/:id',
  }),

  'collections-table': c('collections-table', 'EntityTable', {
    columns: [
      { key: 'title', label: 'Title', sortable: true },
      { key: 'handle', label: 'Handle' },
      { key: 'products_count', label: 'Products', type: 'number' },
      { key: 'created_at', label: 'Created', type: 'date', sortable: true },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/collections/:id',
  }),

  'categories-table': c('categories-table', 'TreeList', {
    title: 'Categories',
    relation: 'product_categories',
    display: { primary: 'name' },
    childrenKey: 'category_children',
    navigateTo: '/categories/:id',
    actions: [{ label: 'Create', to: '/categories/create' }],
  }),

  'customer-groups-table': c('customer-groups-table', 'EntityTable', {
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'customers_count', label: 'Customers', type: 'number' },
      { key: 'created_at', label: 'Created', type: 'date', sortable: true },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/customer-groups/:id',
  }),

  'promotions-table': c('promotions-table', 'EntityTable', {
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'campaign.name', label: 'Campaign' },
    ],
    searchable: true,
    filterable: true,
    pagination: true,
    navigateTo: '/promotions/:id',
  }),

  'campaigns-table': c('campaigns-table', 'EntityTable', {
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description' },
      { key: 'budget.limit', label: 'Budget', type: 'currency' },
      { key: 'starts_at', label: 'Starts', type: 'date' },
      { key: 'ends_at', label: 'Ends', type: 'date' },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/campaigns/:id',
  }),

  'reservations-table': c('reservations-table', 'EntityTable', {
    columns: [
      { key: 'inventory_item.sku', label: 'Inventory Item' },
      { key: 'location.name', label: 'Location' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'description', label: 'Description' },
      { key: 'created_at', label: 'Created', type: 'date', sortable: true },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/reservations/:id',
  }),

  'product-tags-table': c('product-tags-table', 'EntityTable', {
    columns: [
      { key: 'value', label: 'Value' },
      { key: 'created_at', label: 'Created', type: 'date', sortable: true },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/product-tags/:id',
  }),

  'product-types-table': c('product-types-table', 'EntityTable', {
    columns: [
      { key: 'value', label: 'Value' },
      { key: 'created_at', label: 'Created', type: 'date', sortable: true },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/product-types/:id',
  }),

  // ════════════════════════════════════════════════
  // PRODUCT DETAIL COMPONENTS
  // ════════════════════════════════════════════════

  'products-general': c('products-general', 'InfoCard', {
    title: 'General',
    titleField: 'title',
    statusField: 'status',
    fields: [
      { key: 'description', label: 'Description' },
      { key: 'subtitle', label: 'Subtitle' },
      { key: 'handle', label: 'Handle' },
      { key: 'material', label: 'Material' },
      { key: 'discountable', label: 'Discountable', display: 'boolean' },
    ],
    actionGroups: [
      { actions: [{ label: 'Edit', icon: 'PencilSquare', to: '/products/:id/edit' }] },
      { actions: [{ label: 'Delete', icon: 'Trash', action: 'delete', entity: 'products' }] },
    ],
  }),

  'products-media': c('products-media', 'MediaCard', {
    title: 'Media',
    field: 'images',
    actions: [{ label: 'Manage', to: '/products/:id/media' }],
  }),

  'products-options': c('products-options', 'RelationTable', {
    title: 'Options',
    relation: 'options',
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'values', label: 'Values' },
    ],
    actions: [{ label: 'Add Option', to: '/products/:id/options/create' }],
  }),

  'products-variants': c('products-variants', 'RelationTable', {
    title: 'Variants',
    relation: 'variants',
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'sku', label: 'SKU' },
      { key: 'options_label', label: 'Options' },
    ],
    navigateTo: '/products/:productId/variants/:id',
    actions: [{ label: 'Create Variant', to: '/products/:id/variants/create' }],
  }),

  'products-sales-channels': c('products-sales-channels', 'RelationList', {
    title: 'Sales Channels',
    relation: 'sales_channels',
    display: { primary: 'name', secondary: 'description' },
    actions: [{ label: 'Manage', to: '/products/:id/sales-channels' }],
  }),

  'products-organization': c('products-organization', 'InfoCard', {
    title: 'Organization',
    fields: [
      { key: 'type.value', label: 'Type' },
      { key: 'collection.title', label: 'Collection' },
      { key: 'tags', label: 'Tags' },
      { key: 'categories', label: 'Categories' },
    ],
    actions: [{ label: 'Edit', to: '/products/:id/organization' }],
  }),

  // ════════════════════════════════════════════════
  // PRODUCT VARIANT DETAIL COMPONENTS
  // ════════════════════════════════════════════════

  'product-variants-general': c('product-variants-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'sku', label: 'SKU' },
      { key: 'manage_inventory', label: 'Manage Inventory', display: 'boolean' },
    ],
    actions: [{ label: 'Edit', to: '/products/:productId/variants/:id/edit' }],
  }),

  'product-variants-prices': c('product-variants-prices', 'RelationTable', {
    title: 'Prices',
    relation: 'prices',
    columns: [
      { key: 'currency_code', label: 'Currency' },
      { key: 'amount', label: 'Amount', type: 'currency' },
    ],
  }),

  'product-variants-inventory': c('product-variants-inventory', 'RelationTable', {
    title: 'Inventory',
    relation: 'inventory_items',
    columns: [
      { key: 'sku', label: 'SKU' },
      { key: 'stocked_quantity', label: 'In Stock', type: 'number' },
      { key: 'reserved_quantity', label: 'Reserved', type: 'number' },
    ],
    actions: [{ label: 'Manage', to: '/products/:productId/variants/:id/manage-inventory-items' }],
  }),

  // ════════════════════════════════════════════════
  // ORDER DETAIL COMPONENTS
  // ════════════════════════════════════════════════

  'orders-general': c('orders-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'display_id', label: 'Order' },
      { key: 'status', label: 'Status', display: 'badge' },
      { key: 'created_at', label: 'Date', display: 'date' },
      { key: 'email', label: 'Email' },
    ],
  }),

  'orders-summary': c('orders-summary', 'RelationTable', {
    title: 'Summary',
    relation: 'items',
    columns: [
      { key: 'title', label: 'Item' },
      { key: 'quantity', label: 'Qty', type: 'number' },
      { key: 'unit_price', label: 'Unit Price', type: 'currency' },
      { key: 'total', label: 'Total', type: 'currency' },
    ],
    summaries: [
      { label: 'Subtotal', value: { key: 'subtotal', type: 'currency' } },
      { label: 'Shipping', value: { key: 'shipping_total', type: 'currency' } },
      { label: 'Tax', value: { key: 'tax_total', type: 'currency' } },
      { label: 'Total', value: { key: 'total', type: 'currency' } },
    ],
  }),

  'orders-payment': c('orders-payment', 'RelationTable', {
    title: 'Payment',
    relation: 'payment_collections',
    columns: [
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'amount', label: 'Amount', type: 'currency' },
      { key: 'provider_id', label: 'Provider' },
    ],
    actions: [{ label: 'Refund', to: '/orders/:id/refund' }],
  }),

  'orders-fulfillment': c('orders-fulfillment', 'RelationTable', {
    title: 'Fulfillment',
    relation: 'fulfillments',
    columns: [
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'tracking_numbers', label: 'Tracking' },
      { key: 'created_at', label: 'Date', type: 'date' },
    ],
    actions: [{ label: 'Create Fulfillment', to: '/orders/:id/fulfillment' }],
  }),

  'orders-customer': c('orders-customer', 'InfoCard', {
    title: 'Customer',
    fields: [
      { key: 'customer.first_name', label: 'First Name' },
      { key: 'customer.last_name', label: 'Last Name' },
      { key: 'customer.email', label: 'Email' },
      { key: 'shipping_address.city', label: 'City' },
      { key: 'shipping_address.country_code', label: 'Country' },
    ],
  }),

  'orders-activity': c('orders-activity', 'ActivityCard', {
    title: 'Activity',
    relation: 'activities',
  }),

  // ════════════════════════════════════════════════
  // CUSTOMER DETAIL COMPONENTS
  // ════════════════════════════════════════════════

  'customers-general': c('customers-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'first_name', label: 'First Name' },
      { key: 'last_name', label: 'Last Name' },
      { key: 'email', label: 'Email' },
      { key: 'created_at', label: 'Joined', display: 'date' },
    ],
    actions: [{ label: 'Edit', to: '/customers/:id/edit' }],
  }),

  'customers-orders': c('customers-orders', 'RelationTable', {
    title: 'Orders',
    relation: 'orders',
    columns: [
      { key: 'display_id', label: 'Order' },
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'total', label: 'Total', type: 'currency' },
      { key: 'created_at', label: 'Date', type: 'date' },
    ],
    navigateTo: '/orders/:id',
  }),

  // ════════════════════════════════════════════════
  // INVENTORY DETAIL COMPONENTS
  // ════════════════════════════════════════════════

  'inventory-general': c('inventory-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'sku', label: 'SKU' },
      { key: 'title', label: 'Title' },
      { key: 'description', label: 'Description' },
      { key: 'requires_shipping', label: 'Requires Shipping', display: 'boolean' },
    ],
  }),

  'inventory-location-levels': c('inventory-location-levels', 'RelationTable', {
    title: 'Location Levels',
    relation: 'location_levels',
    columns: [
      { key: 'location.name', label: 'Location' },
      { key: 'stocked_quantity', label: 'In Stock', type: 'number' },
      { key: 'reserved_quantity', label: 'Reserved', type: 'number' },
      { key: 'available_quantity', label: 'Available', type: 'number' },
    ],
    actions: [{ label: 'Manage Stock', to: '/inventory/:id/stock' }],
  }),

  'inventory-reservations': c('inventory-reservations', 'RelationTable', {
    title: 'Reservations',
    relation: 'reservations',
    columns: [
      { key: 'location.name', label: 'Location' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'description', label: 'Description' },
    ],
  }),

  // ════════════════════════════════════════════════
  // PRICE LIST DETAIL COMPONENTS
  // ════════════════════════════════════════════════

  'price-lists-general': c('price-lists-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'description', label: 'Description' },
      { key: 'status', label: 'Status', display: 'badge' },
      { key: 'type', label: 'Type' },
    ],
    actions: [{ label: 'Edit', to: '/price-lists/:id/edit' }],
  }),

  'price-lists-configuration': c('price-lists-configuration', 'InfoCard', {
    title: 'Configuration',
    fields: [
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status', display: 'badge' },
      { key: 'starts_at', label: 'Start Date', display: 'date' },
      { key: 'ends_at', label: 'End Date', display: 'date' },
    ],
    actions: [{ label: 'Edit', to: '/price-lists/:id/configuration' }],
  }),

  // ════════════════════════════════════════════════
  // COLLECTION DETAIL COMPONENTS
  // ════════════════════════════════════════════════

  'collections-general': c('collections-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'handle', label: 'Handle' },
    ],
    actions: [{ label: 'Edit', to: '/collections/:id/edit' }],
  }),

  'collections-products': c('collections-products', 'RelationTable', {
    title: 'Products',
    relation: 'products',
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'variants_count', label: 'Variants', type: 'number' },
    ],
    navigateTo: '/products/:id',
    actions: [{ label: 'Add Products', to: '/collections/:id/add-products' }],
  }),

  // ════════════════════════════════════════════════
  // CATEGORY DETAIL COMPONENTS
  // ════════════════════════════════════════════════

  'categories-general': c('categories-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'handle', label: 'Handle' },
      { key: 'is_active', label: 'Active', display: 'boolean' },
      { key: 'is_internal', label: 'Internal', display: 'boolean' },
    ],
    actions: [{ label: 'Edit', to: '/categories/:id/edit' }],
  }),

  'categories-products': c('categories-products', 'RelationTable', {
    title: 'Products',
    relation: 'products',
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'status', label: 'Status', type: 'badge' },
    ],
    navigateTo: '/products/:id',
    actions: [{ label: 'Manage', to: '/categories/:id/products' }],
  }),

  // ════════════════════════════════════════════════
  // CUSTOMER GROUP DETAIL COMPONENTS
  // ════════════════════════════════════════════════

  'customer-groups-general': c('customer-groups-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'created_at', label: 'Created', display: 'date' },
    ],
    actions: [{ label: 'Edit', to: '/customer-groups/:id/edit' }],
  }),

  'customer-groups-customers': c('customer-groups-customers', 'RelationTable', {
    title: 'Customers',
    relation: 'customers',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
    ],
    navigateTo: '/customers/:id',
    actions: [{ label: 'Add Customers', to: '/customer-groups/:id/add-customers' }],
  }),

  // ════════════════════════════════════════════════
  // PROMOTION DETAIL COMPONENTS
  // ════════════════════════════════════════════════

  'promotions-general': c('promotions-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'code', label: 'Code' },
      { key: 'type', label: 'Type' },
      { key: 'is_automatic', label: 'Automatic', display: 'boolean' },
    ],
    actions: [{ label: 'Edit', to: '/promotions/:id/edit' }],
  }),

  'promotions-rules': c('promotions-rules', 'RelationTable', {
    title: 'Rules',
    relation: 'rules',
    columns: [
      { key: 'attribute', label: 'Attribute' },
      { key: 'operator', label: 'Operator' },
      { key: 'values', label: 'Values' },
    ],
  }),

  'promotions-configuration': c('promotions-configuration', 'InfoCard', {
    title: 'Configuration',
    fields: [
      { key: 'type', label: 'Type' },
      { key: 'value_type', label: 'Value Type' },
      { key: 'value', label: 'Value' },
    ],
  }),

  'promotions-campaign': c('promotions-campaign', 'InfoCard', {
    title: 'Campaign',
    fields: [
      { key: 'campaign.name', label: 'Campaign Name' },
      { key: 'campaign.budget.limit', label: 'Budget Limit', display: 'currency' },
    ],
    actions: [{ label: 'Add Campaign', to: '/promotions/:id/add-campaign' }],
  }),

  // ════════════════════════════════════════════════
  // CAMPAIGN DETAIL COMPONENTS
  // ════════════════════════════════════════════════

  'campaigns-general': c('campaigns-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description' },
      { key: 'identifier', label: 'Identifier' },
    ],
    actions: [{ label: 'Edit', to: '/campaigns/:id/edit' }],
  }),

  'campaigns-promotions': c('campaigns-promotions', 'RelationTable', {
    title: 'Promotions',
    relation: 'promotions',
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'type', label: 'Type' },
      { key: 'is_automatic', label: 'Automatic', type: 'boolean' },
    ],
    navigateTo: '/promotions/:id',
    actions: [{ label: 'Add Promotions', to: '/campaigns/:id/add-promotions' }],
  }),

  'campaigns-budget': c('campaigns-budget', 'InfoCard', {
    title: 'Budget',
    fields: [
      { key: 'budget.type', label: 'Type' },
      { key: 'budget.limit', label: 'Limit', display: 'currency' },
      { key: 'budget.used', label: 'Used', display: 'currency' },
    ],
    actions: [{ label: 'Edit', to: '/campaigns/:id/budget-edit' }],
  }),

  // ════════════════════════════════════════════════
  // RESERVATION DETAIL COMPONENTS
  // ════════════════════════════════════════════════

  'reservations-general': c('reservations-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'inventory_item.sku', label: 'Inventory Item' },
      { key: 'location.name', label: 'Location' },
      { key: 'quantity', label: 'Quantity' },
      { key: 'description', label: 'Description' },
      { key: 'created_at', label: 'Created', display: 'date' },
    ],
  }),

  // ════════════════════════════════════════════════
  // PRODUCT TAG DETAIL COMPONENTS
  // ════════════════════════════════════════════════

  'product-tags-general': c('product-tags-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'value', label: 'Value' },
      { key: 'created_at', label: 'Created', display: 'date' },
    ],
    actions: [{ label: 'Edit', to: '/product-tags/:id/edit' }],
  }),

  'product-tags-products': c('product-tags-products', 'RelationTable', {
    title: 'Products',
    relation: 'products',
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'status', label: 'Status', type: 'badge' },
    ],
    navigateTo: '/products/:id',
  }),

  // ════════════════════════════════════════════════
  // PRODUCT TYPE DETAIL COMPONENTS
  // ════════════════════════════════════════════════

  'product-types-general': c('product-types-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'value', label: 'Value' },
      { key: 'created_at', label: 'Created', display: 'date' },
    ],
    actions: [{ label: 'Edit', to: '/product-types/:id/edit' }],
  }),

  'product-types-products': c('product-types-products', 'RelationTable', {
    title: 'Products',
    relation: 'products',
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'status', label: 'Status', type: 'badge' },
    ],
    navigateTo: '/products/:id',
  }),

  // ════════════════════════════════════════════════
  // SETTINGS — SHIPPING PROFILES
  // ════════════════════════════════════════════════

  'shipping-profiles-table': c('shipping-profiles-table', 'EntityTable', {
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/settings/shipping-profiles/:id',
  }),

  'shipping-profiles-general': c('shipping-profiles-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
    ],
  }),

  // ════════════════════════════════════════════════
  // SETTINGS — REFUND REASONS
  // ════════════════════════════════════════════════

  'refund-reasons-table': c('refund-reasons-table', 'EntityTable', {
    columns: [
      { key: 'label', label: 'Label' },
      { key: 'value', label: 'Value' },
    ],
    searchable: true,
    pagination: true,
  }),

  // ════════════════════════════════════════════════
  // SETTINGS — SHIPPING OPTION TYPES
  // ════════════════════════════════════════════════

  'shipping-option-types-table': c('shipping-option-types-table', 'EntityTable', {
    columns: [
      { key: 'label', label: 'Label' },
      { key: 'code', label: 'Code' },
      { key: 'description', label: 'Description' },
      { key: 'created_at', label: 'Created', type: 'date' },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/settings/locations/shipping-option-types/:id',
  }),

  'shipping-option-types-general': c('shipping-option-types-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'label', label: 'Label' },
      { key: 'code', label: 'Code' },
      { key: 'description', label: 'Description' },
    ],
  }),

  // ════════════════════════════════════════════════
  // SETTINGS — WORKFLOW EXECUTIONS
  // ════════════════════════════════════════════════

  'workflow-executions-table': c('workflow-executions-table', 'EntityTable', {
    columns: [
      { key: 'transaction_id', label: 'Transaction ID' },
      { key: 'state', label: 'State', type: 'badge' },
      { key: 'progress', label: 'Progress' },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/settings/workflow-executions/:id',
  }),

  'workflow-executions-general': c('workflow-executions-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'transaction_id', label: 'Transaction ID' },
      { key: 'state', label: 'State', display: 'badge' },
      { key: 'name', label: 'Workflow' },
      { key: 'created_at', label: 'Created', display: 'date' },
    ],
  }),

  'workflow-executions-timeline': c('workflow-executions-timeline', 'ReactBridge', {
    component: 'WorkflowExecutionTimeline',
    fallback: 'Timeline not available',
  }),

  // ════════════════════════════════════════════════
  // SETTINGS — REGIONS
  // ════════════════════════════════════════════════

  'regions-table': c('regions-table', 'EntityTable', {
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'countries', label: 'Countries' },
      { key: 'currency_code', label: 'Currency' },
      { key: 'payment_providers', label: 'Payment Providers' },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/settings/regions/:id',
  }),

  'regions-general': c('regions-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'currency_code', label: 'Currency' },
    ],
    actions: [{ label: 'Edit', to: '/settings/regions/:id/edit' }],
  }),

  'regions-countries': c('regions-countries', 'RelationTable', {
    title: 'Countries',
    relation: 'countries',
    columns: [
      { key: 'display_name', label: 'Country' },
      { key: 'iso_2', label: 'Code' },
    ],
    actions: [{ label: 'Add Countries', to: '/settings/regions/:id/add-countries' }],
  }),

  // ════════════════════════════════════════════════
  // SETTINGS — USERS
  // ════════════════════════════════════════════════

  'users-table': c('users-table', 'EntityTable', {
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role' },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/settings/users/:id',
  }),

  'users-general': c('users-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'first_name', label: 'First Name' },
      { key: 'last_name', label: 'Last Name' },
      { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role' },
    ],
    actions: [{ label: 'Edit', to: '/settings/users/:id/edit' }],
  }),

  // ════════════════════════════════════════════════
  // SETTINGS — SALES CHANNELS
  // ════════════════════════════════════════════════

  'sales-channels-table': c('sales-channels-table', 'EntityTable', {
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description' },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/settings/sales-channels/:id',
  }),

  'sales-channels-general': c('sales-channels-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description' },
    ],
    actions: [{ label: 'Edit', to: '/settings/sales-channels/:id/edit' }],
  }),

  'sales-channels-products': c('sales-channels-products', 'RelationTable', {
    title: 'Products',
    relation: 'products',
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'status', label: 'Status', type: 'badge' },
    ],
    navigateTo: '/products/:id',
    actions: [{ label: 'Add Products', to: '/settings/sales-channels/:id/add-products' }],
  }),

  // ════════════════════════════════════════════════
  // SETTINGS — LOCATIONS
  // ════════════════════════════════════════════════

  'locations-table': c('locations-table', 'EntityTable', {
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'address.city', label: 'City' },
      { key: 'address.country_code', label: 'Country' },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/settings/locations/:id',
  }),

  'locations-general': c('locations-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'address.address_1', label: 'Address' },
      { key: 'address.city', label: 'City' },
      { key: 'address.country_code', label: 'Country' },
    ],
    actions: [{ label: 'Edit', to: '/settings/locations/:id/edit' }],
  }),

  'locations-fulfillment-sets': c('locations-fulfillment-sets', 'RelationTable', {
    title: 'Fulfillment Sets',
    relation: 'fulfillment_sets',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
    ],
    actions: [{ label: 'Manage Providers', to: '/settings/locations/:id/fulfillment-providers' }],
  }),

  // ════════════════════════════════════════════════
  // SETTINGS — TAX REGIONS
  // ════════════════════════════════════════════════

  'tax-regions-table': c('tax-regions-table', 'EntityTable', {
    columns: [
      { key: 'country_code', label: 'Country' },
      { key: 'province_code', label: 'Province' },
      { key: 'default_tax_rate.rate', label: 'Default Rate' },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/settings/tax-regions/:id',
  }),

  'tax-regions-general': c('tax-regions-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'country_code', label: 'Country' },
      { key: 'province_code', label: 'Province' },
    ],
    actions: [{ label: 'Edit', to: '/settings/tax-regions/:id/edit' }],
  }),

  'tax-regions-tax-rates': c('tax-regions-tax-rates', 'RelationTable', {
    title: 'Tax Rates',
    relation: 'tax_rates',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'code', label: 'Code' },
      { key: 'rate', label: 'Rate' },
    ],
    actions: [{ label: 'Create Tax Rate', to: '/settings/tax-regions/:id/tax-rates/create' }],
  }),

  'tax-regions-provinces': c('tax-regions-provinces', 'RelationTable', {
    title: 'Provinces',
    relation: 'provinces',
    columns: [
      { key: 'province_code', label: 'Province' },
      { key: 'default_tax_rate.rate', label: 'Default Rate' },
    ],
    navigateTo: '/settings/tax-regions/:id/provinces/:provinceId',
    actions: [{ label: 'Create Province', to: '/settings/tax-regions/:id/provinces/create' }],
  }),

  // ════════════════════════════════════════════════
  // SETTINGS — RETURN REASONS
  // ════════════════════════════════════════════════

  'return-reasons-table': c('return-reasons-table', 'EntityTable', {
    columns: [
      { key: 'label', label: 'Label' },
      { key: 'value', label: 'Value' },
    ],
    searchable: true,
    pagination: true,
  }),

  // ════════════════════════════════════════════════
  // SETTINGS — API KEYS
  // ════════════════════════════════════════════════

  'api-keys-table': c('api-keys-table', 'EntityTable', {
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'type', label: 'Type' },
      { key: 'created_at', label: 'Created', type: 'date' },
    ],
    searchable: true,
    pagination: true,
    navigateTo: '/settings/api-key-management/:id',
  }),

  'api-keys-general': c('api-keys-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'type', label: 'Type' },
      { key: 'redacted', label: 'Key' },
      { key: 'created_at', label: 'Created', display: 'date' },
    ],
    actions: [{ label: 'Edit', to: '/settings/api-key-management/:id/edit' }],
  }),

  'api-keys-sales-channels': c('api-keys-sales-channels', 'RelationTable', {
    title: 'Sales Channels',
    relation: 'sales_channels',
    columns: [{ key: 'name', label: 'Name' }],
    actions: [{ label: 'Manage', to: '/settings/api-key-management/:id/sales-channels' }],
  }),

  // ════════════════════════════════════════════════
  // TRANSLATIONS
  // ════════════════════════════════════════════════

  'translations-table': c('translations-table', 'ReactBridge', {
    component: 'TranslationsList',
    fallback: 'Translations feature not available',
  }),

  // ════════════════════════════════════════════════
  // PROFILE (top-level)
  // ════════════════════════════════════════════════

  'profile-general': c('profile-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'first_name', label: 'First Name' },
      { key: 'last_name', label: 'Last Name' },
      { key: 'email', label: 'Email' },
    ],
    actions: [{ label: 'Edit', to: '/profile/edit' }],
  }),

  // ════════════════════════════════════════════════
  // STORE (top-level)
  // ════════════════════════════════════════════════

  'store-general': c('store-general', 'InfoCard', {
    title: 'General',
    fields: [
      { key: 'name', label: 'Store Name' },
      { key: 'default_currency_code', label: 'Default Currency' },
    ],
    actions: [{ label: 'Edit', to: '/store/edit' }],
  }),

  'store-currencies': c('store-currencies', 'RelationTable', {
    title: 'Currencies',
    relation: 'supported_currencies',
    columns: [
      { key: 'currency_code', label: 'Currency' },
      { key: 'is_tax_inclusive', label: 'Tax Inclusive', type: 'boolean' },
    ],
    actions: [{ label: 'Add Currencies', to: '/store/add-currencies' }],
  }),
}
