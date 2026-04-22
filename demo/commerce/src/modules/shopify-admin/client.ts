// Minimal Shopify Admin GraphQL client — read-only.
//
// Kept framework-free (no defineModule globals) so it can be imported from
// queries, commands, or standalone maintenance scripts alike. Two env vars:
//   SHOPIFY_SHOP_DOMAIN         — e.g. "fancy-palas.myshopify.com"
//   SHOPIFY_ADMIN_ACCESS_TOKEN  — shpat_...
// An optional SHOPIFY_ADMIN_API_VERSION (default '2025-10') lets us pin.

const DEFAULT_API_VERSION = '2025-10'

export interface ShopifyGraphQLError {
  message: string
  locations?: Array<{ line: number; column: number }>
  path?: Array<string | number>
  extensions?: Record<string, unknown>
}

export class ShopifyAdminClient {
  private readonly endpoint: string
  private readonly token: string

  constructor(opts?: { domain?: string; token?: string; apiVersion?: string }) {
    const domain = opts?.domain ?? process.env.SHOPIFY_SHOP_DOMAIN
    const token = opts?.token ?? process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
    const apiVersion = opts?.apiVersion ?? process.env.SHOPIFY_ADMIN_API_VERSION ?? DEFAULT_API_VERSION
    if (!domain) throw new MantaError('INVALID_DATA', '[shopify-admin] SHOPIFY_SHOP_DOMAIN not set')
    if (!token) throw new MantaError('INVALID_DATA', '[shopify-admin] SHOPIFY_ADMIN_ACCESS_TOKEN not set')
    this.endpoint = `https://${domain}/admin/api/${apiVersion}/graphql.json`
    this.token = token
  }

  async query<T = Record<string, unknown>>(
    gql: string,
    variables?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: gql, variables }),
      signal,
    })
    if (!res.ok) {
      throw new MantaError('UNEXPECTED_STATE', `[shopify-admin] HTTP ${res.status} ${await res.text().catch(() => '')}`)
    }
    const body = (await res.json()) as { data?: T; errors?: ShopifyGraphQLError[] }
    if (body.errors && body.errors.length > 0) {
      throw new MantaError(
        'UNEXPECTED_STATE',
        `[shopify-admin] GraphQL error: ${body.errors.map((e) => e.message).join(' | ')}`,
      )
    }
    if (!body.data) throw new MantaError('UNEXPECTED_STATE', '[shopify-admin] empty response')
    return body.data
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
