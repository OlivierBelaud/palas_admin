import { applyCartEvent } from '../../modules/cart-tracking/apply-cart-event'
import { CART_EVENT_NAMES } from '../../modules/cart-tracking/events'
import type { RawDb } from '../../modules/cart-tracking/refresh-cart'

const ItemDiscountSchema = z.object({
  title: z.string(),
  amount: z.number(),
})

const CartLevelDiscountSchema = z.object({
  title: z.string(),
  amount: z.number(),
})

const CartItemSchema = z.object({
  id: z.string(),
  product_id: z.string(),
  sku: z.string().optional(),
  title: z.string(),
  variant_title: z.string().nullable().optional(),
  quantity: z.number(),
  price: z.number(),
  original_price: z.number().optional(),
  line_price: z.number().optional(),
  total_discount: z.number().optional(),
  discounts: z.array(ItemDiscountSchema).optional(),
  image_url: z.string().nullable().optional(),
  url: z.string().optional(),
})

const ChangedItemSchema = CartItemSchema.extend({
  quantity_change: z.number(),
})

const CheckoutDiscountSchema = z.object({
  title: z.string(),
  type: z.string(),
  value: z.number().nullable(),
  allocation_method: z.string().optional(),
  target_selection: z.string().optional(),
  target_type: z.string().optional(),
})

// ── Funnel stages (ordered) ─────────────────────────────────────────
// Maps each action to a simplified stage that "never goes down"
//
// cart                → playing with cart
// checkout_started    → clicked "Commander" (browsing checkout)
// checkout_engaged    → started filling in info
// payment_attempted   → clicked "Payer"
// completed           → payment succeeded

const STAGES = ['cart', 'checkout_started', 'checkout_engaged', 'payment_attempted', 'completed'] as const
const CHECKOUT_CART_BRIDGE_WINDOW_HOURS = 24

type IngestCartEventCommands = {
  upsertContactFromCartSignal(input: {
    cart_id: string
    email: string
    first_name: string | null
    last_name: string | null
    phone: string | null
    city: string | null
    country_code: string | null
    distinct_id: string | null
    shopify_customer_id: string | null
  }): Promise<unknown>
  attributeSessionConversion(input: {
    cart_id: string
    cart_birth_at: string
    conversion_at: string
    distinct_id: string | null
    email: string | null
    order_id: string | null
  }): Promise<unknown>
}

function actionToStage(action: string): (typeof STAGES)[number] {
  if (action.startsWith('cart:')) return 'cart'
  if (action === 'checkout:started') return 'checkout_started'
  if (action === 'checkout:payment_info_submitted') return 'payment_attempted'
  if (action === 'checkout:completed') return 'completed'
  // contact_info, address_info, shipping_info → all "engaged"
  return 'checkout_engaged'
}

export default defineCommand({
  name: 'ingestCartEvent',
  description: 'Ingest a cart or checkout event from PostHog and update cart tracking tables',
  input: z.object({
    cart_token: z.string(),
    action: z.enum(CART_EVENT_NAMES),
    occurred_at: z.string().datetime(),
    distinct_id: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    country_code: z.string().nullable().optional(),
    browser_locale: z.string().nullable().optional(),
    shopify_customer_id: z.string().nullable().optional(),
    items: z.array(CartItemSchema).default([]),
    changed_items: z.array(ChangedItemSchema).nullable().optional(),
    total_price: z.number().default(0),
    currency: z.string().default('EUR'),
    // Cart-level discount aggregates (from CartPayload — v2 unified schema)
    total_discount: z.number().nullable().optional(),
    cart_level_discounts: z.array(CartLevelDiscountSchema).nullable().optional(),
    // Checkout session identifier (distinct from cart_token, stable per session)
    checkout_token: z.string().nullable().optional(),
    order_id: z.string().nullable().optional(),
    shopify_order_id: z.string().nullable().optional(),
    is_first_order: z.boolean().nullable().optional(),
    shipping_method: z.string().nullable().optional(),
    shipping_price: z.number().nullable().optional(),
    discounts_amount: z.number().nullable().optional(),
    discounts: z.array(CheckoutDiscountSchema).nullable().optional(),
    subtotal_price: z.number().nullable().optional(),
    total_tax: z.number().nullable().optional(),
    raw_properties: z.record(z.unknown()).nullable().optional(),
  }),
  workflow: async (input, { step }) => {
    let recoveryPending = false
    // step.service is typed with module names (MantaGeneratedAppModules), but the runtime
    // Proxy also resolves entity names (cart) to per-entity CRUD. We describe
    // the shape we actually use below.
    type CartRow = {
      id: string
      cart_token?: string | null
      highest_stage: (typeof STAGES)[number]
      status: string
      distinct_id?: string | null
      email?: string | null
      first_name?: string | null
      last_name?: string | null
      phone?: string | null
      city?: string | null
      country_code?: string | null
      browser_locale?: string | null
      shopify_customer_id?: string | null
      checkout_token?: string | null
      order_id?: string | null
      shopify_order_id?: string | null
      is_first_order?: boolean | null
      shipping_method?: string | null
      shipping_price?: number | null
      discounts_amount?: number | null
      discounts?: unknown
      subtotal_price?: number | null
      total_tax?: number | null
      completed_at?: Date | string | null
      cart_birth_at?: Date | string | null
      last_action_at?: Date | string | null
    }
    type EntityCrud<Row> = {
      list: (filters: Record<string, unknown>) => Promise<Row[]>
      create: (data: Record<string, unknown>) => Promise<Row>
      update: (id: string, data: Record<string, unknown>) => Promise<Row>
    }
    // step.service is typed with module names (MantaGeneratedAppModules), but the runtime
    // Proxy also exposes entity names (cart) as CRUD shortcuts not in generated types.
    const svc = step.service as unknown as {
      cart: EntityCrud<CartRow>
    }

    // 1. Find or create the Cart head
    // First try by cart_token (exact match). If a checkout event only carries
    // the Shopify checkout token, match the existing row by checkout_token
    // before falling back to distinct_id.
    let existingCarts = await svc.cart.list({ cart_token: input.cart_token })
    if (existingCarts.length === 0 && input.checkout_token) {
      existingCarts = await svc.cart.list({ checkout_token: input.checkout_token })
    }
    if (existingCarts.length === 0) {
      existingCarts = await svc.cart.list({ checkout_token: input.cart_token })
    }
    if (existingCarts.length === 0 && input.shopify_order_id) {
      existingCarts = await svc.cart.list({ shopify_order_id: input.shopify_order_id })
    }
    if (existingCarts.length === 0 && input.distinct_id && !input.action.startsWith('cart:')) {
      const candidates = await svc.cart.list({ distinct_id: input.distinct_id })
      const occurredMs = new Date(input.occurred_at).getTime()
      const lower = occurredMs - CHECKOUT_CART_BRIDGE_WINDOW_HOURS * 60 * 60 * 1000
      const upper = occurredMs + 10 * 60 * 1000
      existingCarts = candidates
        .filter((cart) => {
          if (cart.highest_stage === 'completed') return false
          const lastActionMs = cart.last_action_at ? new Date(cart.last_action_at).getTime() : Number.NaN
          return Number.isFinite(lastActionMs) && lastActionMs >= lower && lastActionMs <= upper
        })
        .sort((a, b) => {
          const aMs = a.last_action_at ? new Date(a.last_action_at).getTime() : 0
          const bMs = b.last_action_at ? new Date(b.last_action_at).getTime() : 0
          return bMs - aMs
        })
        .slice(0, 1)
    }
    const existing: CartRow | undefined = existingCarts[0]

    // Skip creating a fresh cart row when the FIRST event for this cart_token
    // carries no purchase signal — empty items AND zero total. These are
    // legitimate noise (cart:viewed on an empty cart page). Existing carts are
    // still updated below so their history is preserved (e.g. `cart:cleared`
    // on a real cart correctly sets items to []).
    const hasPurchaseSignal = input.items.length > 0 || input.total_price > 0
    if (!existing && !hasPurchaseSignal) {
      return { cart_id: null, skipped: 'signal-free' as const }
    }

    const newStage = actionToStage(input.action)
    let cartId: string
    let persisted: CartRow
    const applyExisting = (id: string) =>
      step.action('apply-ordered-cart-event', {
        invoke: async (_i: unknown, ctx) => {
          const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
          if (!db) throw new Error('No database configured')
          // Only incoming values enter the atomic merge. A stale service read must
          // never reintroduce identity fields changed by a concurrent event.
          return applyCartEvent<CartRow>(db, id, {
            ...input,
            item_count: input.items.length,
            last_action: input.action,
            last_action_at: input.occurred_at,
            highest_stage: newStage,
          })
        },
        compensate: async () => {},
      })({})
    if (existing) {
      persisted = await applyExisting(existing.id)
      cartId = existing.id
    } else {
      const createData: Record<string, unknown> = {
        cart_token: input.cart_token,
        distinct_id: input.distinct_id ?? null,
        email: input.email ?? null,
        first_name: input.first_name ?? null,
        last_name: input.last_name ?? null,
        phone: input.phone ?? null,
        city: input.city ?? null,
        country_code: input.country_code ?? null,
        browser_locale: input.browser_locale ?? null,
        shopify_customer_id: input.shopify_customer_id ?? null,
        checkout_token: input.checkout_token ?? null,
        items: input.items,
        total_price: input.total_price,
        item_count: input.items.length,
        currency: input.currency,
        last_action: input.action,
        last_action_at: new Date(input.occurred_at),
        highest_stage: newStage,
        status: input.action === 'checkout:completed' ? 'completed' : 'active',
        order_id: input.order_id ?? null,
        shopify_order_id: input.shopify_order_id ?? null,
        is_first_order: input.is_first_order ?? null,
        shipping_method: input.shipping_method ?? null,
        shipping_price: input.shipping_price ?? null,
        discounts_amount: input.discounts_amount ?? null,
        discounts: input.discounts ?? null,
        subtotal_price: input.subtotal_price ?? null,
        total_tax: input.total_tax ?? null,
        cart_birth_at: new Date(input.occurred_at),
      }
      if (input.action === 'checkout:completed') createData.completed_at = new Date(input.occurred_at)
      try {
        const created = await svc.cart.create(createData)
        // CRUD timestamp fields require Date (millisecond precision). Apply the
        // original timestamp atomically before enrichment, retaining microseconds
        // without overwriting a newer event that raced with creation.
        persisted = await applyExisting(created.id)
      } catch (error) {
        // Two first events may both observe no cart. The unique cart token is
        // the arbitration point; the loser still applies its event atomically.
        if (
          !(error && typeof error === 'object' && 'type' in error && error.type === 'DUPLICATE_ERROR') &&
          !/duplicate key|unique constraint/i.test(String(error))
        )
          throw error
        const raced = (await svc.cart.list({ cart_token: input.cart_token }))[0]
        if (!raced) throw error
        persisted = await applyExisting(raced.id)
      }
      cartId = persisted.id
    }

    // 2. Upsert the Contact + cart -> contact link whenever we know an email.
    //    The dedicated command is idempotent: rerunning with the same payload
    //    is a no-op apart from bumping `last_activity_at`. Errors here MUST
    //    NOT block the cart row write — the cart pipeline is the source of
    //    truth, the contact mirror is best-effort enrichment.
    const commands = step.command as unknown as IngestCartEventCommands

    if (persisted.email) {
      try {
        await commands.upsertContactFromCartSignal({
          cart_id: cartId,
          email: persisted.email,
          first_name: persisted.first_name ?? null,
          last_name: persisted.last_name ?? null,
          phone: persisted.phone ?? null,
          city: persisted.city ?? null,
          country_code: persisted.country_code ?? null,
          distinct_id: persisted.distinct_id ?? null,
          shopify_customer_id: persisted.shopify_customer_id ?? null,
        })
      } catch (err) {
        recoveryPending = true
        // Swallow — the contact will be retried on the next event for the
        // same cart. Emit a structured signal so a subscriber can pick it
        // up later if needed.
        await step.emit('contact.upsert_failed', {
          cart_id: cartId,
          email: persisted.email,
          message: (err as Error).message,
        })
      }
    }

    // 3. Conversion attribution invariant: every checkout completion must
    //    try to stamp the matching visitor_session, even if Shopify already
    //    marked the cart completed earlier. The command is idempotent and
    //    protects replays, so this keeps the database clean at ingest time.
    if (input.action === 'checkout:completed') {
      const fresh = await svc.cart.list({ id: cartId })
      const cartBirth = fresh[0]?.cart_birth_at as string | Date | null | undefined
      if (cartBirth) {
        try {
          await commands.attributeSessionConversion({
            cart_id: cartId,
            cart_birth_at: cartBirth instanceof Date ? cartBirth.toISOString() : cartBirth,
            conversion_at: input.occurred_at,
            distinct_id: input.distinct_id ?? existing?.distinct_id ?? null,
            email: input.email ?? existing?.email ?? null,
            order_id: input.shopify_order_id ?? null,
          })
        } catch (err) {
          recoveryPending = true
          await step.emit('visitor_session.attribution_failed', {
            cart_id: cartId,
            message: (err as Error).message,
          })
        }
      }
    }

    await step.emit('cart.refresh-requested', {
      cart_id: cartId,
      cart_token: input.cart_token,
      checkout_token: persisted.checkout_token ?? null,
      shopify_order_id: persisted.shopify_order_id ?? null,
      email: persisted.email?.trim().toLowerCase() ?? null,
      reason: 'cart_event_ingested',
      source: 'ingestCartEvent',
      requested_at: new Date().toISOString(),
    })

    return { cart_id: cartId, ...(recoveryPending ? { recovery_pending: true } : {}) }
  },
})
