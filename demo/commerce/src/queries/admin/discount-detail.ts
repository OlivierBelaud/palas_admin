import { ShopifyAdminClient } from '../../modules/shopify-admin/client'

type DiscountMethod = 'automatic' | 'code'
type DiscountTargetType = 'all' | 'collections' | 'products'
type DiscountValueType = 'percentage' | 'amount'

interface DiscountDetailData {
  discountNode: {
    id: string
    discount: {
      __typename: string
      title?: string
      startsAt?: string
      endsAt?: string | null
      status?: string
      codes?: { nodes?: Array<{ code: string }> }
      appliesOncePerCustomer?: boolean
      usageLimit?: number | null
      combinesWith?: {
        orderDiscounts?: boolean
        productDiscounts?: boolean
        shippingDiscounts?: boolean
      }
      customerGets?: {
        value?: {
          __typename: string
          percentage?: number
          amount?: { amount: string; currencyCode: string }
          appliesOnEachItem?: boolean
        }
        items?: {
          __typename: string
          allItems?: boolean
          collections?: { nodes?: Array<{ id: string; title: string }> }
          products?: { nodes?: Array<{ id: string; title: string }> }
          productVariants?: { nodes?: Array<{ id: string; title: string }> }
        }
      }
    } | null
  } | null
}

type DiscountItemsDetail = NonNullable<
  NonNullable<NonNullable<DiscountDetailData['discountNode']>['discount']>['customerGets']
>['items']

export default defineQuery({
  name: 'discount-detail',
  description: 'Read one Shopify basic discount for the Palas edit form.',
  input: z.object({
    id: z.string().min(1),
  }),
  handler: async (input) => {
    const client = new ShopifyAdminClient()
    const data = await client.query<DiscountDetailData>(
      `
        query PalasDiscountDetail($id: ID!) {
          discountNode(id: $id) {
            id
            discount {
              __typename
              ... on DiscountCodeBasic {
                title
                status
                startsAt
                endsAt
                appliesOncePerCustomer
                usageLimit
                codes(first: 1) { nodes { code } }
                combinesWith { orderDiscounts productDiscounts shippingDiscounts }
                customerGets {
                  value {
                    __typename
                    ... on DiscountPercentage { percentage }
                    ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
                  }
                  items {
                    __typename
                    ... on AllDiscountItems { allItems }
                    ... on DiscountCollections { collections(first: 100) { nodes { id title } } }
                    ... on DiscountProducts {
                      products(first: 100) { nodes { id title } }
                      productVariants(first: 100) { nodes { id title } }
                    }
                  }
                }
              }
              ... on DiscountAutomaticBasic {
                title
                status
                startsAt
                endsAt
                combinesWith { orderDiscounts productDiscounts shippingDiscounts }
                customerGets {
                  value {
                    __typename
                    ... on DiscountPercentage { percentage }
                    ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
                  }
                  items {
                    __typename
                    ... on AllDiscountItems { allItems }
                    ... on DiscountCollections { collections(first: 100) { nodes { id title } } }
                    ... on DiscountProducts {
                      products(first: 100) { nodes { id title } }
                      productVariants(first: 100) { nodes { id title } }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { id: input.id },
    )

    const node = data.discountNode
    if (!node?.discount) throw new MantaError('NOT_FOUND', 'Discount introuvable')

    const discount = node.discount
    if (discount.__typename !== 'DiscountCodeBasic' && discount.__typename !== 'DiscountAutomaticBasic') {
      throw new MantaError('INVALID_DATA', `Edition non supportée pour ${discount.__typename}`)
    }

    const value = discount.customerGets?.value
    const items = discount.customerGets?.items
    const target = normalizeTarget(items)

    return {
      id: node.id,
      type: discount.__typename,
      method:
        discount.__typename === 'DiscountCodeBasic' ? ('code' as DiscountMethod) : ('automatic' as DiscountMethod),
      title: discount.title ?? '',
      code: discount.codes?.nodes?.[0]?.code ?? '',
      status: discount.status ?? 'UNKNOWN',
      starts_at: discount.startsAt ?? '',
      ends_at: discount.endsAt ?? null,
      value_type:
        value?.__typename === 'DiscountAmount' ? ('amount' as DiscountValueType) : ('percentage' as DiscountValueType),
      value:
        value?.__typename === 'DiscountAmount'
          ? Number(value.amount?.amount ?? 0)
          : Math.round(Number(value?.percentage ?? 0) * 10000) / 100,
      target_type: target.type,
      collection_ids: target.collectionIds,
      product_ids: target.productIds,
      applies_once_per_customer: Boolean(discount.appliesOncePerCustomer),
      usage_limit: discount.usageLimit ?? null,
      combines_with_order: Boolean(discount.combinesWith?.orderDiscounts),
      combines_with_product: Boolean(discount.combinesWith?.productDiscounts),
      combines_with_shipping: Boolean(discount.combinesWith?.shippingDiscounts),
    }
  },
})

function normalizeTarget(items: DiscountItemsDetail): {
  type: DiscountTargetType
  collectionIds: string[]
  productIds: string[]
} {
  if (!items || items.__typename === 'AllDiscountItems') {
    return { type: 'all', collectionIds: [], productIds: [] }
  }
  if (items.__typename === 'DiscountCollections') {
    return {
      type: 'collections',
      collectionIds: items.collections?.nodes?.map((node) => node.id) ?? [],
      productIds: [],
    }
  }
  if (items.__typename === 'DiscountProducts') {
    return {
      type: 'products',
      collectionIds: [],
      productIds: items.products?.nodes?.map((node) => node.id) ?? [],
    }
  }
  return { type: 'all', collectionIds: [], productIds: [] }
}
