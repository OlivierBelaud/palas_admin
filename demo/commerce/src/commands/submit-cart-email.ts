// Public command — persist a cart-drawer email submission + dispatch
// Klaviyo subscribe and PostHog event in parallel.
//
// Lives at `src/commands/` (no context folder) → flat, not exposed via
// `/api/:context/command/:name`. Invoked manually from the public route
// `modules/cart-email-capture/api/e/route.ts` which handles HTTP shape
// and CORS.
//
// Why a command and not raw DB in the route: routes don't get
// `step.service` (they'd need direct adapter access), commands do. Keeping
// writes behind the service layer means the adapter wiring stays the
// framework's job, not ours.

import { ShopifyAdminClient } from '../modules/shopify-admin/client'
import { sendKlaviyoEvent, subscribeKlaviyoProfile } from '../utils/klaviyo'
import { sendPosthogEvent } from '../utils/posthog-ingest'

const DISCOUNT_CODE = 'SURPRISE10'
const KLAVIYO_LIST_ID = 'SUtgMh' // "Newsletter"
const SOURCE = 'cart_drawer_surprise'
const EVENT_NAME = 'cart:email_form_submitted'

interface EmailCaptureRow {
  id: string
  email: string
  cart_token: string | null
  is_test: boolean
}

interface EntityCrud<Row> {
  create: (data: Record<string, unknown>) => Promise<Row>
  update: (id: string, data: Record<string, unknown>) => Promise<Row>
}

interface ShopifyLookup {
  number_of_orders: number
  customer_id: string | null
}

// Fail-open: if Shopify lookup throws, we treat the submitter as a new
// visitor (discount granted) rather than denying. Losing the discount to
// an API hiccup is worse UX than granting one extra to a repeat customer.
async function lookupShopifyCustomer(email: string, log: { warn: (m: string) => void }): Promise<ShopifyLookup> {
  try {
    const client = new ShopifyAdminClient()
    const data = await client.query<{
      customers: { edges: Array<{ node: { id: string; numberOfOrders: string | number | null } }> }
    }>(
      `query ($q: String!) {
        customers(first: 1, query: $q) {
          edges { node { id numberOfOrders } }
        }
      }`,
      { q: `email:"${email.replace(/"/g, '\\"')}"` },
    )
    const node = data.customers?.edges?.[0]?.node
    if (!node) return { number_of_orders: 0, customer_id: null }
    const raw = node.numberOfOrders
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : 0
    return { number_of_orders: Number.isFinite(n) ? n : 0, customer_id: node.id }
  } catch (err) {
    log.warn(`[submitCartEmail] shopify lookup failed for ${email}: ${(err as Error).message}`)
    return { number_of_orders: 0, customer_id: null }
  }
}

export default defineCommand({
  name: 'submitCartEmail',
  description:
    'Persist a cart-drawer "surprise" email submission and fan out to Klaviyo (subscribe + event) + PostHog (identify + event). Returns the discount code the theme should auto-apply.',
  input: z.object({
    email: z.string().email(),
    cart_token: z.string().nullable().optional(),
    market: z.string().max(8).nullable().optional(),
    posthog_distinct_id: z.string().max(128).nullable().optional(),
    is_test: z.boolean().default(false),
    user_agent: z.string().nullable().optional(),
    remote_ip: z.string().nullable().optional(),
  }),
  workflow: async (input, { step, log }) => {
    const email = input.email.toLowerCase()

    // 1. Persist + Shopify lookup in parallel. DB insert doesn't depend on the
    //    Shopify result; running them together shaves the Shopify RTT off the
    //    theme's perceived latency. Service layer handles adapter wiring +
    //    schema validation. Runtime Proxy resolves `emailCapture` to the
    //    auto-generated CRUD even though it's not surfaced in
    //    MantaGeneratedAppModules yet.
    const svc = step.service as unknown as { emailCapture: EntityCrud<EmailCaptureRow> }
    const [row, shop] = await Promise.all([
      svc.emailCapture.create({
        email,
        cart_token: input.cart_token ?? null,
        source: SOURCE,
        market: input.market ?? null,
        posthog_distinct_id: input.posthog_distinct_id ?? null,
        is_test: input.is_test,
        user_agent: input.user_agent ?? null,
        remote_ip: input.remote_ip ?? null,
      }),
      lookupShopifyCustomer(email, log),
    ])

    const isExistingCustomer = shop.number_of_orders > 0
    const discountCode = isExistingCustomer ? null : DISCOUNT_CODE

    log.info(
      `[submitCartEmail] captured id=${row.id} email=${email} test=${input.is_test} ` +
        `orders=${shop.number_of_orders} discount=${discountCode ?? 'none'}`,
    )

    // 2. In test mode we stop here — no external noise (Klaviyo / PostHog).
    if (input.is_test) {
      return {
        id: row.id,
        discount_code: discountCode,
        is_existing_customer: isExistingCustomer,
        number_of_orders: shop.number_of_orders,
      }
    }

    // 3. Fan out. Three independent network calls, no ordering constraints.
    //    Each helper is already never-throw (returns { ok, status, error }).
    //    We still fire identify/event for existing customers — we want them
    //    in Klaviyo flows even without a discount grant.
    const eventProps = {
      source: SOURCE,
      market: input.market ?? null,
      cart_token: input.cart_token ?? null,
      discount_code: discountCode,
      is_existing_customer: isExistingCustomer,
      number_of_orders: shop.number_of_orders,
      shopify_customer_id: shop.customer_id,
    }
    const [subRes, evtRes, phRes] = await Promise.allSettled([
      subscribeKlaviyoProfile({ email, listId: KLAVIYO_LIST_ID, customSource: SOURCE }),
      sendKlaviyoEvent({
        email,
        metric: EVENT_NAME,
        properties: eventProps,
        unique_id: row.id,
      }),
      sendPosthogEvent({
        event: EVENT_NAME,
        distinctId: input.posthog_distinct_id ?? email,
        email,
        ip: input.remote_ip ?? null,
        properties: eventProps,
      }),
    ])

    const klOk =
      (subRes.status === 'fulfilled' && subRes.value.ok) || (evtRes.status === 'fulfilled' && evtRes.value.ok)
    const phOk = phRes.status === 'fulfilled' && phRes.value.ok

    if (!klOk) log.warn(`[submitCartEmail] klaviyo dispatch failed for ${email}`)
    if (!phOk) log.warn(`[submitCartEmail] posthog dispatch failed for ${email}`)

    // 4. Record sync timestamps on the row so the admin list can show
    //    which captures reached Klaviyo/PostHog and which need retry.
    if (klOk || phOk) {
      const now = new Date()
      try {
        await svc.emailCapture.update(row.id, {
          klaviyo_synced_at: klOk ? now : null,
          posthog_synced_at: phOk ? now : null,
        })
      } catch (err) {
        log.warn(`[submitCartEmail] mark-synced failed: ${(err as Error).message}`)
      }
    }

    return {
      id: row.id,
      discount_code: discountCode,
      is_existing_customer: isExistingCustomer,
      number_of_orders: shop.number_of_orders,
    }
  },
})
