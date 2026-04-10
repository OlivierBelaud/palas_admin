import { CART_EVENT_NAMES } from '../../modules/cart-tracking/events'

const ItemDiscountSchema = z.object({
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
    shopify_customer_id: z.string().nullable().optional(),
    items: z.array(CartItemSchema).default([]),
    changed_items: z.array(ChangedItemSchema).nullable().optional(),
    total_price: z.number().default(0),
    currency: z.string().default('EUR'),
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
    // Proxy also resolves entity names (cart, cartEvent) to per-entity CRUD. We describe
    // the shape we actually use below.
    type CartRow = {
      id: string
      highest_stage: (typeof STAGES)[number]
      status: string
      distinct_id?: string | null
      email?: string | null
      first_name?: string | null
      last_name?: string | null
      phone?: string | null
      city?: string | null
      country_code?: string | null
      shopify_customer_id?: string | null
      order_id?: string | null
      shopify_order_id?: string | null
      is_first_order?: boolean | null
      shipping_method?: string | null
      shipping_price?: number | null
      discounts_amount?: number | null
      discounts?: unknown
      subtotal_price?: number | null
      total_tax?: number | null
    }
    type EntityCrud<Row> = {
      list: (filters: Record<string, unknown>) => Promise<Row[]>
      create: (data: Record<string, unknown>) => Promise<Row>
      update: (id: string, data: Record<string, unknown>) => Promise<Row>
    }
    // step.service is typed with module names (MantaGeneratedAppModules), but the runtime
    // Proxy also exposes entity names (cart, cartEvent) as CRUD shortcuts not in generated types.
    const svc = step.service as unknown as {
      cart: EntityCrud<CartRow>
      cartEvent: EntityCrud<Record<string, unknown>>
    }

    // 1. Find or create the Cart head
    const existingCarts = await svc.cart.list({ cart_token: input.cart_token })
    const existing: CartRow | undefined = existingCarts[0]

    const newStage = actionToStage(input.action)
    const newStageIdx = STAGES.indexOf(newStage)
    const currentStageIdx = existing ? STAGES.indexOf(existing.highest_stage) : -1
    const highestStage = STAGES[Math.max(currentStageIdx, newStageIdx)]

    // Status: completed if checkout:completed, otherwise active
    // (abandonment is detected later by a scheduled job based on inactivity)
    const status = input.action === 'checkout:completed' ? 'completed' : (existing?.status ?? 'active')

    // Merge identity: keep existing values, fill in new ones progressively
    const merge = <A, B>(newVal: A, existingVal: B): A | B | null => newVal ?? existingVal ?? null

    const cartData = {
      cart_token: input.cart_token,
      distinct_id: merge(input.distinct_id, existing?.distinct_id),
      email: merge(input.email, existing?.email),
      first_name: merge(input.first_name, existing?.first_name),
      last_name: merge(input.last_name, existing?.last_name),
      phone: merge(input.phone, existing?.phone),
      city: merge(input.city, existing?.city),
      country_code: merge(input.country_code, existing?.country_code),
      shopify_customer_id: merge(input.shopify_customer_id, existing?.shopify_customer_id),
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
      await svc.cart.update(existing.id, cartData)
      cartId = existing.id
    } else {
      const created = await svc.cart.create(cartData)
      cartId = created.id
    }

    // 2. Always append the event (append-only log)
    await svc.cartEvent.create({
      cart_id: cartId,
      action: input.action,
      items_snapshot: input.items,
      total_price: input.total_price,
      item_count: input.items.length,
      currency: input.currency,
      changed_items: input.changed_items ?? null,
      occurred_at: new Date(input.occurred_at),
      distinct_id: input.distinct_id ?? null,
      email: input.email ?? null,
      order_id: input.order_id ?? null,
      shipping_method: input.shipping_method ?? null,
      shipping_price: input.shipping_price ?? null,
      discounts_amount: input.discounts_amount ?? null,
      discounts: input.discounts ?? null,
      raw_properties: input.raw_properties ?? null,
    })

    return { cart_id: cartId }
  },
})
