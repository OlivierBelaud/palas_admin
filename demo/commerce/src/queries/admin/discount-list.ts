import { paginateConnection, ShopifyAdminClient } from '../../modules/shopify-admin/client'

type DiscountGroup = 'shop' | 'individual'

interface DiscountCodeRef {
  code: string
}

interface DiscountCodeCount {
  count?: number
}

interface DiscountCombinesWith {
  orderDiscounts?: boolean
  productDiscounts?: boolean
  shippingDiscounts?: boolean
}

interface ShopifyDiscountBase {
  __typename: string
  title?: string
  status?: string
  startsAt?: string
  endsAt?: string | null
  createdAt?: string
  updatedAt?: string
  summary?: string
  shortSummary?: string
  asyncUsageCount?: number
  discountClasses?: string[]
  combinesWith?: DiscountCombinesWith
  codes?: { nodes?: DiscountCodeRef[] }
  codesCount?: DiscountCodeCount
  appliesOncePerCustomer?: boolean
  usageLimit?: number | null
}

interface ShopifyDiscountNode {
  id: string
  discount: ShopifyDiscountBase
}

interface DiscountRow {
  id: string
  shopify_id: string
  title: string
  type: string
  method: 'automatic' | 'code' | 'app' | 'unknown'
  group: DiscountGroup
  status: string
  is_active: boolean
  starts_at: string | null
  ends_at: string | null
  updated_at: string | null
  usage_count: number
  usage_limit: number | null
  applies_once_per_customer: boolean
  codes_count: number | null
  sample_codes: string[]
  discount_classes: string[]
  combines_with: string[]
  summary: string
  classification_reason: string
}

export default defineQuery({
  name: 'discount-list',
  description: 'Live Shopify discounts grouped for Palas promotion operations.',
  input: z.object({
    limit: z.number().int().positive().max(500).default(250),
  }),
  handler: async (input) => {
    const client = new ShopifyAdminClient()
    const nodes = await paginateConnection<ShopifyDiscountNode>(
      client,
      (cursor) => ({
        query: DISCOUNTS_QUERY,
        variables: { cursor },
      }),
      (data) => {
        const conn = (data.discountNodes ?? {}) as {
          edges?: Array<{ node: ShopifyDiscountNode }>
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
        }
        return {
          nodes: (conn.edges ?? []).map((edge) => edge.node),
          hasNextPage: Boolean(conn.pageInfo?.hasNextPage),
          endCursor: conn.pageInfo?.endCursor ?? null,
        }
      },
      { hardCap: input.limit },
    )

    const rows = nodes.map(normalizeDiscount).sort(sortDiscounts)
    const shop = rows.filter((row) => row.group === 'shop')
    const individual = rows.filter((row) => row.group === 'individual')

    return {
      meta: {
        generated_at: new Date().toISOString(),
        total: rows.length,
        active: rows.filter((row) => row.is_active).length,
        shop: shop.length,
        individual: individual.length,
      },
      shop,
      individual,
    }
  },
})

function normalizeDiscount(node: ShopifyDiscountNode): DiscountRow {
  const discount = node.discount ?? { __typename: 'UnknownDiscount' }
  const method = discountMethod(discount.__typename)
  const codes = discount.codes?.nodes?.map((node) => node.code).filter(Boolean) ?? []
  const codesCount = discount.codesCount?.count ?? (codes.length > 0 ? codes.length : null)
  const classification = classifyDiscount(discount, method, codes, codesCount)

  return {
    id: node.id,
    shopify_id: node.id,
    title: discount.title ?? '(Discount sans titre)',
    type: discount.__typename,
    method,
    group: classification.group,
    status: discount.status ?? 'UNKNOWN',
    is_active: discount.status === 'ACTIVE',
    starts_at: discount.startsAt ?? null,
    ends_at: discount.endsAt ?? null,
    updated_at: discount.updatedAt ?? discount.createdAt ?? null,
    usage_count: discount.asyncUsageCount ?? 0,
    usage_limit: discount.usageLimit ?? null,
    applies_once_per_customer: Boolean(discount.appliesOncePerCustomer),
    codes_count: codesCount,
    sample_codes: codes,
    discount_classes: discount.discountClasses ?? [],
    combines_with: combinesWithLabels(discount.combinesWith),
    summary: discount.shortSummary ?? discount.summary ?? '',
    classification_reason: classification.reason,
  }
}

function discountMethod(typeName: string): DiscountRow['method'] {
  if (typeName.includes('Automatic')) return 'automatic'
  if (typeName.includes('Code')) return 'code'
  if (typeName.includes('App')) return 'app'
  return 'unknown'
}

function classifyDiscount(
  discount: ShopifyDiscountBase,
  method: DiscountRow['method'],
  codes: string[],
  codesCount: number | null,
): { group: DiscountGroup; reason: string } {
  if (method === 'automatic') return { group: 'shop', reason: 'automatic discount' }

  const haystack = [discount.title, discount.summary, discount.shortSummary, ...codes].filter(Boolean).join(' ')
  const lifecyclePattern =
    /\b(klaviyo|welcome|bienvenue|abandoned|abandon|cart|panier|recovery|recover|surprise|palas10)\b/i
  const looksLifecycle = lifecyclePattern.test(haystack)

  if (looksLifecycle) {
    return { group: 'individual', reason: 'lifecycle/customer code naming' }
  }

  if (method === 'code' && discount.usageLimit === 1) {
    return { group: 'individual', reason: 'single-use code' }
  }

  if (method === 'code' && discount.appliesOncePerCustomer && (codesCount ?? 0) > 20) {
    return { group: 'individual', reason: 'multi-code customer pool' }
  }

  return { group: 'shop', reason: method === 'code' ? 'public/manual code' : 'fallback' }
}

function combinesWithLabels(combinesWith: DiscountCombinesWith | undefined): string[] {
  if (!combinesWith) return []
  const labels: string[] = []
  if (combinesWith.orderDiscounts) labels.push('order')
  if (combinesWith.productDiscounts) labels.push('product')
  if (combinesWith.shippingDiscounts) labels.push('shipping')
  return labels
}

function sortDiscounts(a: DiscountRow, b: DiscountRow): number {
  if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
  return new Date(b.updated_at ?? b.starts_at ?? 0).getTime() - new Date(a.updated_at ?? a.starts_at ?? 0).getTime()
}

const CODE_FIELDS = `
  title
  status
  startsAt
  endsAt
  createdAt
  updatedAt
  summary
  shortSummary
  asyncUsageCount
  discountClasses
  appliesOncePerCustomer
  usageLimit
  combinesWith {
    orderDiscounts
    productDiscounts
    shippingDiscounts
  }
  codesCount { count }
  codes(first: 5) {
    nodes { code }
  }
`

const AUTOMATIC_FIELDS = `
  title
  status
  startsAt
  endsAt
  createdAt
  updatedAt
  summary
  shortSummary
  asyncUsageCount
  discountClasses
  combinesWith {
    orderDiscounts
    productDiscounts
    shippingDiscounts
  }
`

const DISCOUNTS_QUERY = `
  query PalasDiscountList($cursor: String) {
    discountNodes(first: 100, after: $cursor, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          discount {
            __typename
            ... on DiscountCodeBasic { ${CODE_FIELDS} }
            ... on DiscountCodeBxgy { ${CODE_FIELDS} }
            ... on DiscountCodeFreeShipping { ${CODE_FIELDS} }
            ... on DiscountAutomaticBasic { ${AUTOMATIC_FIELDS} }
            ... on DiscountAutomaticBxgy { ${AUTOMATIC_FIELDS} }
            ... on DiscountAutomaticFreeShipping { ${AUTOMATIC_FIELDS} }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`
