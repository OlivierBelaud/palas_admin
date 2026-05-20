export type OrderSalesChannel =
  | 'online_store'
  | 'pos'
  | 'private_sale'
  | 'wholesale'
  | 'draft_order'
  | 'external_app'
  | 'unknown'

export interface OrderChannelInput {
  source_name?: string | null
  source_identifier?: string | null
  app_name?: string | null
  channel_name?: string | null
  tags?: string[] | null
}

export interface OrderChannelClassification {
  sales_channel: OrderSalesChannel
  include_in_ecommerce_analytics: boolean
  analytics_exclusion_reason: string | null
}

export function classifyOrderChannel(input: OrderChannelInput): OrderChannelClassification {
  const sourceName = clean(input.source_name)
  const sourceIdentifier = clean(input.source_identifier)
  const appName = clean(input.app_name)
  const channelName = clean(input.channel_name)
  const tags = input.tags?.map((tag) => tag.trim()).filter(Boolean) ?? []
  const haystack = [sourceName, sourceIdentifier, appName, channelName, ...tags].join(' ').toLowerCase()

  if (sourceName === 'pos' || appName === 'Point of Sale' || channelName === 'Point of Sale') {
    return excluded('pos', 'shopify_pos')
  }
  if (sourceName === 'shopify_draft_order' || appName === 'Draft Orders') {
    return excluded('draft_order', 'shopify_draft_order')
  }
  if (haystack.includes('faire') || haystack.includes('ankorstore') || appName === 'Reseller') {
    return excluded('wholesale', 'wholesale_channel')
  }
  if (
    appName === 'Syncio Multi Store Sync' ||
    haystack.includes('thebradery') ||
    haystack.includes('bradery') ||
    haystack.includes('vente privée') ||
    haystack.includes('vente privee') ||
    haystack.includes('private sale') ||
    haystack.includes('my-moon-store') ||
    haystack.includes('lesbienfaiteurs')
  ) {
    return excluded('private_sale', 'private_sale_channel')
  }
  if (appName === 'Choose' || haystack.includes('polen') || haystack.includes('pollen')) {
    return excluded('external_app', 'external_app_channel')
  }
  if (
    sourceName === 'web' ||
    sourceName === 'checkout_next' ||
    appName === 'Online Store' ||
    appName === 'Shop' ||
    appName === 'TikTok' ||
    channelName === 'Online Store' ||
    channelName === 'Shop' ||
    channelName === 'TikTok'
  ) {
    return {
      sales_channel: 'online_store',
      include_in_ecommerce_analytics: true,
      analytics_exclusion_reason: null,
    }
  }
  return excluded('unknown', 'unknown_non_online_channel')
}

function excluded(sales_channel: OrderSalesChannel, reason: string): OrderChannelClassification {
  return { sales_channel, include_in_ecommerce_analytics: false, analytics_exclusion_reason: reason }
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed || null
}
