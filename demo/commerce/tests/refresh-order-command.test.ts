import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../src/modules/order/refresh-order', () => ({
  normalizeShopifyOrderId: (value: string | number) => String(value),
  fetchShopifyOrderSnapshot: vi.fn(async () => ({
    shopify_order_id: '9001',
    shopify_customer_id: 'customer_1',
    email: 'buyer@example.com',
    items: [],
  })),
}))

type CommandDefinition = {
  workflow(
    input: Record<string, unknown>,
    context: {
      step: Record<string, unknown>
      log: { info(message: string): void; warn(message: string): void }
    },
  ): Promise<unknown>
}

let command: CommandDefinition

beforeAll(async () => {
  type SchemaChain = {
    min(): SchemaChain
    nullable(): SchemaChain
    optional(): SchemaChain
    default(): SchemaChain
  }
  const chain: SchemaChain = {
    min: () => chain,
    nullable: () => chain,
    optional: () => chain,
    default: () => chain,
  }
  vi.stubGlobal('defineCommand', (definition: CommandDefinition) => definition)
  vi.stubGlobal('z', {
    object: () => ({}),
    string: () => chain,
    boolean: () => chain,
  })
  command = (await import('../src/commands/admin/refresh-order')).default as unknown as CommandDefinition
})

describe('refreshOrder command', () => {
  it('uses the authoritative Shopify customer id before email when linking a contact', async () => {
    const writes: Array<{ sql: string; params?: unknown[] }> = []
    const db = {
      raw: async (sql: string, params?: unknown[]) => {
        writes.push({ sql, params })
        return []
      },
    }
    const action = (
      _name: string,
      config: {
        invoke(input: unknown, context: Record<string, unknown>): Promise<unknown>
      },
    ) => {
      return (input: unknown) =>
        config.invoke(input, {
          app: { resolve: () => db },
        })
    }
    const emit = vi.fn(async () => undefined)
    const step = {
      service: {
        order: {
          listOrders: async () => [],
          upsertWithReplace: async () => [{ id: 'order_1' }],
        },
      },
      action,
      emit,
    }

    await command.workflow(
      {
        shopify_order_id: '9001',
        dryRun: false,
      },
      {
        step,
        log: { info: vi.fn(), warn: vi.fn() },
      },
    )

    expect(writes).toHaveLength(1)
    expect(writes[0]?.sql).toContain('$3::text IS NOT NULL AND c.shopify_customer_id = $3')
    expect(writes[0]?.sql).toContain('$3::text IS NULL')
    expect(writes[0]?.params).toEqual(['order_1', 'buyer@example.com', 'customer_1'])
    expect(emit).toHaveBeenCalledWith(
      'cart.refresh-requested',
      expect.objectContaining({ shopify_order_id: '9001' }),
    )
  })
})
