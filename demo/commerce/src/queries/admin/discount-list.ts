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
    group: z.enum(['shop', 'individual', 'all']).default('all'),
    page_size: z.number().int().positive().max(100).default(50),
    after: z.string().nullable().optional(),
    search: z.string().trim().default(''),
    status: z.enum(['all', 'active', 'scheduled', 'expired']).default('all'),
  }),
  handler: async (input) => {
    const client = new ShopifyAdminClient()
    const group = input.group ?? 'all'
    if (group !== 'all') {
      return fetchGroupedDiscountPage(client, {
        group,
        pageSize: input.page_size ?? 50,
        after: input.after ?? null,
        search: input.search ?? '',
        status: input.status ?? 'all',
      })
    }

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

    const rows = nodes
      .map(normalizeDiscount)
      .filter((row) => matchesFilters(row, input.search ?? '', input.status ?? 'all'))
      .sort(sortDiscounts)
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
      page_info: {
        has_next_page: false,
        end_cursor: null,
        scanned: rows.length,
      },
      shop,
      individual,
    }
  },
})

async function fetchGroupedDiscountPage(
  client: ShopifyAdminClient,
  input: {
    group: DiscountGroup
    pageSize: number
    after: string | null
    search: string
    status: 'all' | 'active' | 'scheduled' | 'expired'
  },
) {
  const rows: DiscountRow[] = []
  let cursor = input.after
  let hasNextPage = true
  let scanned = 0
  const maxScanned = Math.max(input.pageSize * 20, 500)

  while (hasNextPage && rows.length < input.pageSize && scanned < maxScanned) {
    const data = await client.query<{
      discountNodes?: {
        edges?: Array<{ node: ShopifyDiscountNode }>
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
      }
    }>(DISCOUNTS_QUERY, { cursor })
    const conn = data.discountNodes ?? {}
    const nodes = conn.edges?.map((edge) => edge.node) ?? []
    scanned += nodes.length

    for (const node of nodes) {
      const row = normalizeDiscount(node)
      if (row.group !== input.group) continue
      if (!matchesFilters(row, input.search, input.status)) continue
      rows.push(row)
      if (rows.length >= input.pageSize) break
    }

    cursor = conn.pageInfo?.endCursor ?? null
    hasNextPage = Boolean(conn.pageInfo?.hasNextPage && cursor)
  }

  const sortedRows = rows.sort(sortDiscounts)
  const shop = input.group === 'shop' ? sortedRows : []
  const individual = input.group === 'individual' ? sortedRows : []

  return {
    meta: {
      generated_at: new Date().toISOString(),
      total: sortedRows.length,
      active: sortedRows.filter((row) => row.is_active).length,
      shop: shop.length,
      individual: individual.length,
    },
    page_info: {
      has_next_page: hasNextPage && Boolean(cursor),
      end_cursor: cursor,
      scanned,
    },
    shop,
    individual,
  }
}

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

function matchesFilters(row: DiscountRow, search: string, status: 'all' | 'active' | 'scheduled' | 'expired'): boolean {
  if (status === 'active' && !row.is_active) return false
  if (status === 'scheduled' && row.status !== 'SCHEDULED') return false
  if (status === 'expired' && row.status !== 'EXPIRED') return false
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [row.title, row.type, row.status, row.summary, row.classification_reason, ...row.sample_codes]
    .join(' ')
    .toLowerCase()
    .includes(needle)
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

const CODE_BXGY_FIELDS = `
  title
  status
  startsAt
  endsAt
  createdAt
  updatedAt
  summary
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

const AUTOMATIC_BXGY_FIELDS = `
  title
  status
  startsAt
  endsAt
  createdAt
  updatedAt
  summary
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
            ... on DiscountCodeBxgy { ${CODE_BXGY_FIELDS} }
            ... on DiscountCodeFreeShipping { ${CODE_FIELDS} }
            ... on DiscountAutomaticBasic { ${AUTOMATIC_FIELDS} }
            ... on DiscountAutomaticBxgy { ${AUTOMATIC_BXGY_FIELDS} }
            ... on DiscountAutomaticFreeShipping { ${AUTOMATIC_FIELDS} }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`
