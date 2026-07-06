import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const createdRows: Array<Record<string, unknown>> = []
const updatedRows: Array<Record<string, unknown>> = []

beforeEach(() => {
  vi.resetModules()
  createdRows.length = 0
  updatedRows.length = 0
  vi.stubGlobal('z', z)
  vi.stubGlobal('MantaError', class MantaError extends Error {})
  vi.stubGlobal('defineCommand', (definition: unknown) => definition)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function loadCommand() {
  return (await import('../upsert-marketing-rule')).default as unknown as {
    workflow: (input: Record<string, unknown>, context: Record<string, unknown>) => Promise<Record<string, unknown>>
  }
}

function context() {
  const upsertShopifyDiscount = vi.fn(async () => {
    throw new Error('Shopify must not be called')
  })
  return {
    upsertShopifyDiscount,
    context: {
      step: {
        service: {
          marketingRule: {
            list: vi.fn(async () => []),
            create: vi.fn(async (data: Record<string, unknown>) => {
              const row = { id: `rule_${createdRows.length + 1}`, ...data }
              createdRows.push(row)
              return row
            }),
            update: vi.fn(async (id: string, data: Record<string, unknown>) => {
              const row = { id, ...data }
              updatedRows.push(row)
              return row
            }),
          },
        },
        command: { upsertShopifyDiscount },
        emit: vi.fn(async () => undefined),
      },
      log: { warn: vi.fn() },
    },
  }
}

describe('upsertMarketingRule local-only rules', () => {
  it('stores first-order/personal offers locally without touching Shopify', async () => {
    const command = await loadCommand()
    const setup = context()

    const row = await command.workflow(
      {
        title: 'Offre de bienvenue',
        rule_type: 'first_order_discount',
        status: 'active',
        starts_at: '2026-07-06T00:00:00.000Z',
        value_type: 'percentage',
        value: 10,
        personal_offer: 'welcome',
      },
      setup.context,
    )

    expect(setup.upsertShopifyDiscount).not.toHaveBeenCalled()
    expect(row.execution_kind).toBe('local_cart_rule')
    expect(row.sync_status).toBe('local_only')
    expect(row.payload).toMatchObject({ source: 'palas_admin', personal_offer: 'welcome' })
  })

  it('stores gift threshold rules locally without touching Shopify', async () => {
    const command = await loadCommand()
    const setup = context()

    const row = await command.workflow(
      {
        title: 'Charm offert',
        rule_type: 'gift_threshold',
        status: 'active',
        starts_at: '2026-07-06T00:00:00.000Z',
        threshold: 150,
        gift_product_id: 'gid://shopify/ProductVariant/gift_1',
        gift_title: 'Charm mystere',
      },
      setup.context,
    )

    expect(setup.upsertShopifyDiscount).not.toHaveBeenCalled()
    expect(row.execution_kind).toBe('local_cart_rule')
    expect(row.sync_status).toBe('local_only')
    expect(row.gift_product_id).toBe('gid://shopify/ProductVariant/gift_1')
  })
})
