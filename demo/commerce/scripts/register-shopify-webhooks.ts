// Register the orders/paid webhook with Shopify Admin API.
//
// One-shot. Idempotent: if a subscription already exists pointing at our
// callback URL, skip. Otherwise create it.
//
// IMPORTANT about the HMAC secret:
//   - When a webhook is created via Shopify's Admin GraphQL API (this script),
//     Shopify signs deliveries with the *App's* shared secret (the one in the
//     Partners dashboard for a custom/public app), NOT with a per-subscription
//     value. The `webhookSubscriptionCreate` mutation does NOT accept a secret
//     parameter — Shopify generates the signature using the access token's
//     app secret.
//   - For a custom (Admin-API-token) app, that "app secret" surfaces in the
//     Shopify Admin → Apps → <YourApp> → "API credentials" panel as the
//     "API secret key".
//   - We have set SHOPIFY_WEBHOOK_SECRET to a 64-char hex value. If that
//     value does NOT match the API secret key of the app whose admin access
//     token is in SHOPIFY_ADMIN_ACCESS_TOKEN, the route's HMAC verification
//     WILL fail in prod — and there's no API way to set the secret.
//   - Resolution path if mismatched:
//       a) Read the actual API secret key in the Shopify Admin dashboard
//          (Apps → Develop apps → <your app> → API credentials), then update
//          the `SHOPIFY_WEBHOOK_SECRET` env var in Vercel + local
//          .env.production to that value.
//       b) Trigger a Shopify webhook test delivery from the dashboard and
//          confirm the route returns 200 in the Webhook Activity log.
//
// Run with:
//   pnpm exec tsx demo/commerce/scripts/register-shopify-webhooks.ts --prod

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function loadEnv(rel: string, override: boolean): void {
  const full = resolve(here, '..', rel)
  try {
    const raw = readFileSync(full, 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (override || !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch {
    // ignore
  }
}

const useProd = process.argv.includes('--prod')
loadEnv('.env', false)
if (useProd) loadEnv('.env.production', true)

const SHOPIFY_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN ?? 'fancy-palas.myshopify.com'
const SHOPIFY_TOKEN =
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_ACCESS_TOKEN
const API_VER = process.env.SHOPIFY_ADMIN_API_VERSION ?? '2025-10'
const ADMIN_BASE = (process.env.ADMIN_BASE_URL ?? 'https://admin.fancypalas.com').replace(/\/+$/, '')

if (!SHOPIFY_TOKEN) {
  console.error('[register-shopify-webhooks] missing SHOPIFY_ADMIN_ACCESS_TOKEN env')
  process.exit(1)
}

const ORDERS_PAID_ENDPOINT = `${ADMIN_BASE}/api/cart-tracking/shopify-webhooks/orders-paid`
const CUSTOMERS_ENDPOINT = `${ADMIN_BASE}/api/cart-tracking/shopify-webhooks/customers`
const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/${API_VER}/graphql.json`

type WebhookTopic = 'ORDERS_PAID' | 'CUSTOMERS_CREATE' | 'CUSTOMERS_UPDATE'

interface TopicBinding {
  topic: WebhookTopic
  endpoint: string
}

const BINDINGS: TopicBinding[] = [
  { topic: 'ORDERS_PAID', endpoint: ORDERS_PAID_ENDPOINT },
  { topic: 'CUSTOMERS_CREATE', endpoint: CUSTOMERS_ENDPOINT },
  { topic: 'CUSTOMERS_UPDATE', endpoint: CUSTOMERS_ENDPOINT },
]

interface ShopifyGraphQLError {
  message: string
}
interface GraphQLResponse<T> {
  data?: T
  errors?: ShopifyGraphQLError[]
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN as string,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status} ${await res.text().catch(() => '')}`)
  }
  const body = (await res.json()) as GraphQLResponse<T>
  if (body.errors && body.errors.length > 0) {
    throw new Error(`Shopify GraphQL: ${body.errors.map((e) => e.message).join(' | ')}`)
  }
  if (!body.data) throw new Error('Shopify GraphQL: empty response')
  return body.data
}

interface ExistingSubscriptionsData {
  webhookSubscriptions: {
    edges: Array<{
      node: {
        id: string
        topic: string
        // The HTTP endpoint shows up here when format = HTTP / JSON.
        endpoint: { __typename: string; callbackUrl?: string }
      }
    }>
  }
}

interface CreateSubscriptionData {
  webhookSubscriptionCreate: {
    webhookSubscription: { id: string } | null
    userErrors: Array<{ field: string[] | null; message: string }>
  }
}

async function ensureSubscription(binding: TopicBinding): Promise<void> {
  // 1) Inspect existing subscriptions for this topic.
  const existing = await gql<ExistingSubscriptionsData>(
    `query ListWebhooks($topic: WebhookSubscriptionTopic!) {
       webhookSubscriptions(first: 50, topics: [$topic]) {
         edges {
           node {
             id
             topic
             endpoint {
               __typename
               ... on WebhookHttpEndpoint { callbackUrl }
             }
           }
         }
       }
     }`,
    { topic: binding.topic },
  )
  const edges = existing.webhookSubscriptions.edges
  console.log(`[register-shopify-webhooks] existing ${binding.topic} subscriptions: ${edges.length}`)
  for (const e of edges) {
    console.log(`  - ${e.node.id}  ${e.node.endpoint.callbackUrl ?? '(non-HTTP endpoint)'}`)
  }

  const alreadyBound = edges.find((e) => e.node.endpoint.callbackUrl === binding.endpoint)
  if (alreadyBound) {
    console.log(`[register-shopify-webhooks] ${binding.topic} already subscribed (${alreadyBound.node.id}) — no-op`)
    return
  }

  // 2) Create the subscription. Shopify will sign deliveries with our app's
  //    API secret — see header comment on the SECRET caveat.
  const created = await gql<CreateSubscriptionData>(
    `mutation Create($topic: WebhookSubscriptionTopic!, $cb: URL!) {
       webhookSubscriptionCreate(
         topic: $topic,
         webhookSubscription: { callbackUrl: $cb, format: JSON }
       ) {
         webhookSubscription { id }
         userErrors { field message }
       }
     }`,
    { topic: binding.topic, cb: binding.endpoint },
  )
  const result = created.webhookSubscriptionCreate
  if (result.userErrors.length > 0) {
    for (const ue of result.userErrors) {
      console.error(`  ${binding.topic} userError: ${ue.field?.join('.') ?? '(no field)'} → ${ue.message}`)
    }
    process.exitCode = 1
    return
  }
  if (!result.webhookSubscription) {
    console.error(`[register-shopify-webhooks] no subscription returned for ${binding.topic} — unexpected`)
    process.exitCode = 1
    return
  }
  console.log(`[register-shopify-webhooks] subscribed ${binding.topic} → ${result.webhookSubscription.id}`)
}

async function main(): Promise<void> {
  console.log(`[register-shopify-webhooks] target: ${useProd ? 'PROD' : 'LOCAL'}`)
  console.log(`[register-shopify-webhooks] shop:   ${SHOPIFY_DOMAIN}`)
  console.log(`[register-shopify-webhooks] api:    ${API_VER}`)
  console.log(`[register-shopify-webhooks] orders-paid endpoint: ${ORDERS_PAID_ENDPOINT}`)
  console.log(`[register-shopify-webhooks] customers endpoint:   ${CUSTOMERS_ENDPOINT}`)

  for (const binding of BINDINGS) {
    await ensureSubscription(binding)
  }

  console.log('[register-shopify-webhooks] reminder: confirm SHOPIFY_WEBHOOK_SECRET matches the App API secret key')
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
