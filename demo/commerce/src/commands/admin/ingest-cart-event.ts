import { CART_EVENT_NAMES } from '../../modules/cart-tracking/events'

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
    const newStageIdx = STAGES.indexOf(newStage)
    const currentStageIdx = existing ? STAGES.indexOf(existing.highest_stage) : -1
    const highestStage = STAGES[Math.max(currentStageIdx, newStageIdx)]

    // Status: completed if checkout:completed, otherwise active
    // (abandonment is detected later by a scheduled job based on inactivity)
    const status = input.action === 'checkout:completed' ? 'completed' : (existing?.status ?? 'active')

    // Merge identity: keep existing values, fill in new ones progressively
    const merge = <A, B>(newVal: A, existingVal: B): A | B | null => newVal ?? existingVal ?? null

    // Base payload — shared between create and update. `cart_birth_at` and
    // `completed_at` are deliberately omitted here: they have asymmetric
    // semantics (set-once on create vs. conditional on update) and are
    // handled below.
    const cartData = {
      cart_token: existing?.cart_token ?? input.cart_token,
      distinct_id: merge(input.distinct_id, existing?.distinct_id),
      email: merge(input.email, existing?.email),
      first_name: merge(input.first_name, existing?.first_name),
      last_name: merge(input.last_name, existing?.last_name),
      phone: merge(input.phone, existing?.phone),
      city: merge(input.city, existing?.city),
      country_code: merge(input.country_code, existing?.country_code),
      // Navigation language: refresh whenever a new event carries one (latest
      // browse wins), else keep the previously captured value.
      browser_locale: merge(input.browser_locale, existing?.browser_locale),
      shopify_customer_id: merge(input.shopify_customer_id, existing?.shopify_customer_id),
      checkout_token: merge(input.checkout_token, existing?.checkout_token),
      items: input.items,
      total_price: input.total_price,
      item_count: input.items.length,
      currency: input.currency,
      last_action: input.action,
      last_action_at: new Date(input.occurred_at),
      highest_stage: highestStage,
      status,
      order_id: merge(input.order_id, existing?.order_id),
      shopify_order_id: merge(input.shopify_order_id, existing?.shopify_order_id),
      is_first_order: input.is_first_order ?? existing?.is_first_order ?? null,
      shipping_method: merge(input.shipping_method, existing?.shipping_method),
      shipping_price: input.shipping_price ?? existing?.shipping_price ?? null,
      discounts_amount: input.discounts_amount ?? existing?.discounts_amount ?? null,
      discounts: input.discounts ?? existing?.discounts ?? null,
      subtotal_price: input.subtotal_price ?? existing?.subtotal_price ?? null,
      total_tax: input.total_tax ?? existing?.total_tax ?? null,
    }

    let cartId: string
    if (existing) {
      // Update path — NEVER touch `cart_birth_at` (immutable). Only set
      // `completed_at` on the first cart→completed transition: triple
      // guard (`checkout:completed`, current stage isn't already
      // 'completed', no existing `completed_at`) keeps the write
      // idempotent across replays.
      const shouldSetCompletedAt =
        input.action === 'checkout:completed' && existing.highest_stage !== 'completed' && existing.completed_at == null
      const updateData: Record<string, unknown> = { ...cartData }
      if (shouldSetCompletedAt) updateData.completed_at = new Date(input.occurred_at)
      await svc.cart.update(existing.id, updateData)
      cartId = existing.id
    } else {
      // Create path — write `cart_birth_at` from the event timestamp.
      // This is the immutable "first time we ever heard from this cart"
      // anchor used by cohort attribution and funnel analytics. It is
      // distinct from `created_at` (which gets re-stamped by rebuilds).
      const createData: Record<string, unknown> = {
        ...cartData,
        cart_birth_at: new Date(input.occurred_at),
      }
      // When the first event we see for a brand-new cart is already
      // `checkout:completed` (rare but possible — e.g. Apple Pay / fast
      // checkout), capture `completed_at` too. Otherwise leave NULL.
      if (input.action === 'checkout:completed') {
        createData.completed_at = new Date(input.occurred_at)
      }
      const created = await svc.cart.create(createData)
      cartId = created.id
    }

    // 2. Upsert the Contact + cart -> contact link whenever we know an email.
    //    The dedicated command is idempotent: rerunning with the same payload
    //    is a no-op apart from bumping `last_activity_at`. Errors here MUST
    //    NOT block the cart row write — the cart pipeline is the source of
    //    truth, the contact mirror is best-effort enrichment.
    if (input.email) {
      try {
        await step.command.upsertContactFromCartSignal({
          cart_id: cartId,
          email: input.email,
          first_name: input.first_name ?? null,
          last_name: input.last_name ?? null,
          phone: input.phone ?? null,
          city: input.city ?? null,
          country_code: input.country_code ?? null,
          distinct_id: input.distinct_id ?? null,
          shopify_customer_id: input.shopify_customer_id ?? null,
        })
      } catch (err) {
        // Swallow — the contact will be retried on the next event for the
        // same cart. Emit a structured signal so a subscriber can pick it
        // up later if needed.
        await step.emit('contact.upsert_failed', {
          cart_id: cartId,
          email: input.email,
          message: (err as Error).message,
        })
      }
    }

    // 3. Cohort late-update: when a cart transitions to completed for the
    //    first time, attribute the conversion back to the visitor_session
    //    that was active at cart_birth_at. Best-effort — failures emit a
    //    signal but do NOT abort the ingest.
    const wasCompleted = existing?.highest_stage === 'completed'
    const becomesCompleted = input.action === 'checkout:completed' && !wasCompleted
    if (becomesCompleted) {
      const fresh = await svc.cart.list({ id: cartId })
      const cartBirth = fresh[0]?.cart_birth_at as string | Date | null | undefined
      if (cartBirth) {
        try {
          await step.command.attributeSessionConversion({
            cart_id: cartId,
            cart_birth_at: cartBirth instanceof Date ? cartBirth.toISOString() : cartBirth,
            conversion_at: input.occurred_at,
            distinct_id: input.distinct_id ?? existing?.distinct_id ?? null,
            email: input.email ?? existing?.email ?? null,
            order_id: input.shopify_order_id ?? null,
          })
        } catch (err) {
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
      checkout_token: input.checkout_token ?? null,
      shopify_order_id: input.shopify_order_id ?? null,
      email: input.email?.trim().toLowerCase() ?? null,
      reason: 'cart_event_ingested',
      source: 'ingestCartEvent',
      requested_at: new Date().toISOString(),
    })

    return { cart_id: cartId }
  },
})
