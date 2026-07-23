// Minimal Shopify Admin GraphQL client.
//
// Kept framework-free (no defineModule globals) so it can be imported from
// queries, commands, or standalone maintenance scripts alike. Two env vars:
//   SHOPIFY_SHOP_DOMAIN         — e.g. "fancy-palas.myshopify.com"
//   SHOPIFY_ADMIN_ACCESS_TOKEN  — shpat_...
// Transport configuration, timeouts and provider error classification live in
// one framework-free module shared with scripts and Vercel fast functions.

import {
  type ShopifyAdminOptions,
  shopifyAdminGraphql,
} from '../../../vercel-fast-functions/shopify-admin-transport.mjs'

export { ShopifyAdminTransportError } from '../../../vercel-fast-functions/shopify-admin-transport.mjs'

export interface ShopifyGraphQLError {
  message: string
  locations?: Array<{ line: number; column: number }>
  path?: Array<string | number>
  extensions?: Record<string, unknown>
}

export class ShopifyAdminClient {
  private readonly options: ShopifyAdminOptions

  constructor(opts?: ShopifyAdminOptions) {
    this.options = opts ?? {}
  }

  async query<T = Record<string, unknown>>(
    gql: string,
    variables?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    return await shopifyAdminGraphql<T>(gql, variables, { ...this.options, signal })
  }
}

/**
 * Build a Shopify search query string that OR-combines a list of emails.
 * Shopify's search syntax supports `email:foo@bar.com OR email:bar@baz.com`.
 * Emails with special chars are quoted.
 */
export function orEmailsQuery(emails: string[], extraClauses?: string[]): string {
  const clauses = emails.map((e) => `email:"${e.replace(/"/g, '\\"')}"`).join(' OR ')
  const extras = extraClauses?.length ? ` AND (${extraClauses.join(' AND ')})` : ''
  return emails.length > 1 ? `(${clauses})${extras}` : `${clauses}${extras}`
}

/**
 * Paginate a GraphQL connection field until fully drained or hard cap reached.
 * Assumes the shape `{ edges: [{ node }], pageInfo: { hasNextPage, endCursor } }`.
 */
export async function paginateConnection<T>(
  client: ShopifyAdminClient,
  gql: (cursor: string | null) => { query: string; variables: Record<string, unknown> },
  extract: (data: Record<string, unknown>) => {
    nodes: T[]
    hasNextPage: boolean
    endCursor: string | null
  },
  opts?: { hardCap?: number; signal?: AbortSignal },
): Promise<T[]> {
  const hardCap = opts?.hardCap ?? 5000
  const out: T[] = []
  let cursor: string | null = null
  while (out.length < hardCap) {
    const { query, variables } = gql(cursor)
    const data = await client.query(query, variables, opts?.signal)
    const { nodes, hasNextPage, endCursor } = extract(data as Record<string, unknown>)
    out.push(...nodes)
    if (!hasNextPage || !endCursor) break
    cursor = endCursor
  }
  return out
}
