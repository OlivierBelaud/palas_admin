// ──────────────────────────────────────────────
// Injection Mapping — Medusa widget zones → page arrays
// ──────────────────────────────────────────────

export interface ZoneTarget {
  page: string
  column: 'main' | 'sidebar'
  position: 'first' | 'last'
}

export interface WidgetInjection {
  ref: string
  position: 'first' | 'last'
}

// ──────────────────────────────────────────────
// Entity → page ID mapping
// ──────────────────────────────────────────────

const entityPageMap: Record<string, { list: string; detail: string }> = {
  product: { list: 'products/list', detail: 'products/detail' },
  order: { list: 'orders/list', detail: 'orders/detail' },
  customer: { list: 'customers/list', detail: 'customers/detail' },
  customer_group: { list: 'customer-groups/list', detail: 'customer-groups/detail' },
  product_variant: { list: 'product-variants/list', detail: 'product-variants/detail' },
  product_collection: { list: 'collections/list', detail: 'collections/detail' },
  product_category: { list: 'categories/list', detail: 'categories/detail' },
  product_type: { list: 'product-types/list', detail: 'product-types/detail' },
  product_tag: { list: 'product-tags/list', detail: 'product-tags/detail' },
  shipping_option_type: { list: 'shipping-option-types/list', detail: 'shipping-option-types/detail' },
  price_list: { list: 'price-lists/list', detail: 'price-lists/detail' },
  promotion: { list: 'promotions/list', detail: 'promotions/detail' },
  campaign: { list: 'campaigns/list', detail: 'campaigns/detail' },
  user: { list: 'users/list', detail: 'users/detail' },
  region: { list: 'regions/list', detail: 'regions/detail' },
  shipping_profile: { list: 'shipping-profiles/list', detail: 'shipping-profiles/detail' },
  location: { list: 'locations/list', detail: 'locations/detail' },
  sales_channel: { list: 'sales-channels/list', detail: 'sales-channels/detail' },
  reservation: { list: 'reservations/list', detail: 'reservations/detail' },
  api_key: { list: 'api-keys/list', detail: 'api-keys/detail' },
  workflow: { list: 'workflow-executions/list', detail: 'workflow-executions/detail' },
  tax: { list: 'tax-regions/list', detail: 'tax-regions/detail' },
  return_reason: { list: 'return-reasons/list', detail: 'return-reasons/detail' },
  refund_reason: { list: 'refund-reasons/list', detail: 'refund-reasons/detail' },
  inventory_item: { list: 'inventory/list', detail: 'inventory/detail' },
  store: { list: 'store/list', detail: 'store/detail' },
  profile: { list: 'profile/list', detail: 'profile/detail' },
}

// ──────────────────────────────────────────────
// Build zone mapping from zone patterns
// ──────────────────────────────────────────────

// Entities with 4 detail zones (before/after + side.before/side.after)
const entitiesWithSideZones = [
  'product',
  'order',
  'customer',
  'product_variant',
  'product_category',
  'price_list',
  'promotion',
  'campaign',
  'location',
  'reservation',
  'inventory_item',
]

// Entities with only 2 detail zones (before/after, no side)
const entitiesWithoutSideZones = [
  'customer_group',
  'product_collection',
  'product_type',
  'product_tag',
  'shipping_option_type',
  'user',
  'region',
  'shipping_profile',
  'sales_channel',
  'api_key',
  'workflow',
  'tax',
  'store',
  'profile',
]

// Entities with list zones
const entitiesWithListZones = [
  'product',
  'order',
  'customer',
  'customer_group',
  'product_collection',
  'product_category',
  'product_type',
  'product_tag',
  'shipping_option_type',
  'price_list',
  'promotion',
  'campaign',
  'user',
  'region',
  'shipping_profile',
  'location',
  'sales_channel',
  'reservation',
  'api_key',
  'workflow',
  'tax',
  'return_reason',
  'refund_reason',
  'inventory_item',
]

// Entities with list side zones (rare)
const entitiesWithListSideZones = ['location']

function buildZoneMapping(): Record<string, ZoneTarget> {
  const mapping: Record<string, ZoneTarget> = {}

  // Detail zones
  for (const entity of [...entitiesWithSideZones, ...entitiesWithoutSideZones]) {
    const pages = entityPageMap[entity]
    if (!pages) continue

    mapping[`${entity}.details.before`] = { page: pages.detail, column: 'main', position: 'first' }
    mapping[`${entity}.details.after`] = { page: pages.detail, column: 'main', position: 'last' }

    if (entitiesWithSideZones.includes(entity)) {
      mapping[`${entity}.details.side.before`] = { page: pages.detail, column: 'sidebar', position: 'first' }
      mapping[`${entity}.details.side.after`] = { page: pages.detail, column: 'sidebar', position: 'last' }
    }
  }

  // List zones
  for (const entity of entitiesWithListZones) {
    const pages = entityPageMap[entity]
    if (!pages) continue

    mapping[`${entity}.list.before`] = { page: pages.list, column: 'main', position: 'first' }
    mapping[`${entity}.list.after`] = { page: pages.list, column: 'main', position: 'last' }

    if (entitiesWithListSideZones.includes(entity)) {
      mapping[`${entity}.list.side.before`] = { page: pages.list, column: 'sidebar', position: 'first' }
      mapping[`${entity}.list.side.after`] = { page: pages.list, column: 'sidebar', position: 'last' }
    }
  }

  // Special: login zones
  mapping['login.before'] = { page: 'login', column: 'main', position: 'first' }
  mapping['login.after'] = { page: 'login', column: 'main', position: 'last' }

  return mapping
}

export const zoneMapping: Record<string, ZoneTarget> = buildZoneMapping()

// ──────────────────────────────────────────────
// ALL_ZONES — complete enumeration
// ──────────────────────────────────────────────

export const ALL_ZONES: string[] = Object.keys(zoneMapping).sort()

// ──────────────────────────────────────────────
// resolveZone
// ──────────────────────────────────────────────

export function resolveZone(zone: string): ZoneTarget | undefined {
  return zoneMapping[zone]
}

// ──────────────────────────────────────────────
// injectWidgets — insert refs into page element arrays
// ──────────────────────────────────────────────

export function injectWidgets(elements: string[], injections: WidgetInjection[]): string[] {
  if (injections.length === 0) return elements

  const result = [...elements]
  const firsts: string[] = []
  const lasts: string[] = []

  for (const injection of injections) {
    if (injection.position === 'first') {
      firsts.push(injection.ref)
    } else {
      lasts.push(injection.ref)
    }
  }

  return [...firsts, ...result, ...lasts]
}
