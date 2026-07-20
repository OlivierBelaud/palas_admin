import { beforeAll, describe, expect, it, vi } from 'vitest'

type CommandDefinition = {
  workflow(input: Record<string, unknown>, context: { step: Record<string, unknown> }): Promise<unknown>
}

let command: CommandDefinition

beforeAll(async () => {
  type SchemaChain = {
    nullable(): SchemaChain
    optional(): SchemaChain
    default(): SchemaChain
    datetime(): SchemaChain
    extend(): SchemaChain
  }
  const chain: SchemaChain = {
    nullable: () => chain,
    optional: () => chain,
    default: () => chain,
    datetime: () => chain,
    extend: () => chain,
  }
  vi.stubGlobal('defineCommand', (definition: CommandDefinition) => definition)
  vi.stubGlobal('z', {
    object: () => chain,
    string: () => chain,
    number: () => chain,
    boolean: () => chain,
    enum: () => chain,
    array: () => chain,
    record: () => chain,
    unknown: () => chain,
  })
  command = (await import('../src/commands/admin/ingest-cart-event')).default as unknown as CommandDefinition
})

function input(overrides: Record<string, unknown> = {}) {
  return {
    cart_token: 'cart_1',
    action: 'checkout:shipping_info_submitted',
    occurred_at: '2026-07-20T10:00:00.000Z',
    distinct_id: null,
    email: null,
    first_name: null,
    last_name: null,
    phone: null,
    city: null,
    country_code: null,
    browser_locale: null,
    shopify_customer_id: null,
    items: [],
    changed_items: null,
    total_price: 0,
    currency: 'EUR',
    cart_has_payload: false,
    items_has_payload: false,
    total_price_has_payload: false,
    currency_has_payload: false,
    checkout_token: 'checkout_1',
    order_id: null,
    shopify_order_id: null,
    is_first_order: null,
    shipping_method: null,
    shipping_price: null,
    discounts_amount: null,
    discounts: null,
    subtotal_price: null,
    total_tax: null,
    raw_properties: {},
    ...overrides,
  }
}

function cartContext(existing: Record<string, unknown>, commands: Record<string, unknown> = {}) {
  const update = vi.fn(async () => existing)
  const emit = vi.fn(async () => undefined)
  return {
    update,
    emit,
    step: {
      service: {
        cart: {
          list: vi.fn(async () => [existing]),
          create: vi.fn(),
          update,
        },
      },
      command: commands,
      emit,
    },
  }
}

describe('ingestCartEvent command replay semantics', () => {
  it('preserves the known cart snapshot when a checkout event has no embedded cart payload', async () => {
    const existing = {
      id: 'cart_row_1',
      cart_token: 'cart_1',
      highest_stage: 'cart',
      status: 'active',
      distinct_id: 'anonymous_1',
      items: [{ id: 'variant_1', title: 'Bracelet', quantity: 1 }],
      total_price: 49,
      item_count: 1,
      currency: 'EUR',
      last_action_at: '2026-07-20T09:00:00.000Z',
    }
    const { step, update } = cartContext(existing)

    await command.workflow(input(), { step })

    expect(update).toHaveBeenCalledWith(
      'cart_row_1',
      expect.objectContaining({
        items: existing.items,
        total_price: 49,
        item_count: 1,
        currency: 'EUR',
      }),
    )
  })

  it('does not regress current cart state when an older event is replayed', async () => {
    const existing = {
      id: 'cart_row_1',
      cart_token: 'cart_1',
      highest_stage: 'checkout_started',
      status: 'active',
      distinct_id: 'anonymous_1',
      items: [{ id: 'variant_current', title: 'Bracelet', quantity: 2 }],
      total_price: 98,
      item_count: 2,
      currency: 'EUR',
      last_action: 'checkout:started',
      last_action_at: '2026-07-20T10:00:00.000Z',
    }
    const { step, update } = cartContext(existing)

    await command.workflow(
      input({
        action: 'cart:product_added',
        occurred_at: '2026-07-20T09:00:00.000Z',
        cart_has_payload: true,
        items_has_payload: true,
        total_price_has_payload: true,
        currency_has_payload: true,
        items: [{ id: 'variant_stale', title: 'Old item', quantity: 1 }],
        total_price: 10,
      }),
      { step },
    )

    expect(update).toHaveBeenCalledWith(
      'cart_row_1',
      expect.objectContaining({
        items: existing.items,
        total_price: 98,
        item_count: 2,
        last_action: 'checkout:started',
        last_action_at: new Date('2026-07-20T10:00:00.000Z'),
      }),
    )
  })

  it('updates checkout totals without erasing items omitted by the pixel', async () => {
    const existing = {
      id: 'cart_row_1',
      cart_token: 'cart_1',
      highest_stage: 'checkout_started',
      status: 'active',
      distinct_id: 'anonymous_1',
      items: [{ id: 'variant_1', title: 'Bracelet', quantity: 1 }],
      total_price: 49,
      item_count: 1,
      currency: 'EUR',
      last_action: 'checkout:started',
      last_action_at: '2026-07-20T09:00:00.000Z',
    }
    const { step, update } = cartContext(existing)

    await command.workflow(
      input({
        action: 'checkout:shipping_info_submitted',
        occurred_at: '2026-07-20T10:00:00.000Z',
        cart_has_payload: true,
        items_has_payload: false,
        total_price_has_payload: true,
        currency_has_payload: true,
        items: [],
        total_price: 59,
      }),
      { step },
    )

    expect(update).toHaveBeenCalledWith(
      'cart_row_1',
      expect.objectContaining({
        items: existing.items,
        item_count: 1,
        total_price: 59,
        currency: 'EUR',
      }),
    )
  })

  it('attaches late identity without replacing the anonymous history or a bound Shopify identity', async () => {
    const existing = {
      id: 'cart_row_1',
      cart_token: 'cart_1',
      highest_stage: 'cart',
      status: 'active',
      distinct_id: 'anonymous_1',
      email: null,
      shopify_customer_id: 'shopify_customer_1',
      items: [{ id: 'variant_1', title: 'Bracelet', quantity: 1 }],
      total_price: 49,
      item_count: 1,
      currency: 'EUR',
      last_action_at: '2026-07-20T09:00:00.000Z',
    }
    const upsertContactFromCartSignal = vi.fn(async () => undefined)
    const { step, update } = cartContext(existing, { upsertContactFromCartSignal })

    await command.workflow(
      input({
        distinct_id: 'identified_2',
        email: 'buyer@example.com',
        shopify_customer_id: 'shopify_customer_conflict',
      }),
      { step },
    )

    expect(update).toHaveBeenCalledWith(
      'cart_row_1',
      expect.objectContaining({
        distinct_id: 'anonymous_1',
        email: 'buyer@example.com',
        shopify_customer_id: 'shopify_customer_1',
      }),
    )
    expect(upsertContactFromCartSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        cart_id: 'cart_row_1',
        email: 'buyer@example.com',
        distinct_id: 'anonymous_1',
        shopify_customer_id: 'shopify_customer_1',
      }),
    )
  })

  it('never repoints contact enrichment when a later event carries a conflicting email', async () => {
    const existing = {
      id: 'cart_row_1',
      cart_token: 'cart_1',
      highest_stage: 'cart',
      status: 'active',
      distinct_id: 'anonymous_1',
      email: 'owner@example.com',
      shopify_customer_id: 'shopify_customer_1',
      items: [{ id: 'variant_1', title: 'Bracelet', quantity: 1 }],
      total_price: 49,
      item_count: 1,
      currency: 'EUR',
      last_action_at: '2026-07-20T09:00:00.000Z',
    }
    const upsertContactFromCartSignal = vi.fn(async () => undefined)
    const { step, emit } = cartContext(existing, { upsertContactFromCartSignal })

    await command.workflow(input({ email: 'other@example.com' }), { step })

    expect(upsertContactFromCartSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'owner@example.com',
        distinct_id: 'anonymous_1',
        shopify_customer_id: 'shopify_customer_1',
      }),
    )
    expect(emit).toHaveBeenLastCalledWith(
      'cart.refresh-requested',
      expect.objectContaining({ email: 'owner@example.com' }),
    )
  })
})
