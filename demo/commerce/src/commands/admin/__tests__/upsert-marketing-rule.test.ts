import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const createdRows: Array<Record<string, unknown>> = []
const updatedRows: Array<Record<string, unknown>> = []
const shopifyRequests: Array<{ query: string; variables: Record<string, unknown> }> = []
const originalToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

beforeEach(() => {
  vi.resetModules()
  createdRows.length = 0
  updatedRows.length = 0
  shopifyRequests.length = 0
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = 'test-token'
  vi.stubGlobal('z', z)
  vi.stubGlobal('MantaError', class MantaError extends Error {})
  vi.stubGlobal('defineCommand', (definition: unknown) => definition)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { query: string; variables?: Record<string, unknown> }
      shopifyRequests.push({ query: body.query, variables: body.variables ?? {} })
      if (body.query.includes('PalasGiftVariant')) {
        return Response.json({
          data: {
            node: {
              id: body.variables?.id,
              price: '45.00',
              compareAtPrice: null,
              product: {
                id: 'gid://shopify/Product/gift_product_1',
                metafield: null,
              },
            },
          },
        })
      }
      if (body.query.includes('PalasUpdateGiftVariant')) {
        const input = body.variables?.input as { id?: string } | undefined
        return Response.json({
          data: {
            productVariantUpdate: {
              productVariant: { id: input?.id },
              userErrors: [],
            },
          },
        })
      }
      if (body.query.includes('PalasSetGiftOnlyMetafield')) {
        return Response.json({
          data: {
            metafieldsSet: {
              metafields: [{ id: 'gid://shopify/Metafield/gift_only' }],
              userErrors: [],
            },
          },
        })
      }
      return Response.json({ data: {} })
    }),
  )
})

afterEach(() => {
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = originalToken
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

  it('prepares gift threshold variants in Shopify without creating a discount', async () => {
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
    expect(row.sync_status).toBe('synced')
    expect(row.shopify_id).toBe('gid://shopify/Product/gift_product_1')
    expect(row.gift_product_id).toBe('gid://shopify/ProductVariant/gift_1')
    expect(row.payload).toMatchObject({
      gift_variant_id: 'gid://shopify/ProductVariant/gift_1',
      gift_product_id: 'gid://shopify/Product/gift_product_1',
      gift_original_price: 45,
    })
    expect(shopifyRequests.map((request) => request.query)).toEqual([
      expect.stringContaining('PalasGiftVariant'),
      expect.stringContaining('PalasUpdateGiftVariant'),
      expect.stringContaining('PalasSetGiftOnlyMetafield'),
    ])
    expect(shopifyRequests[1]?.variables).toMatchObject({
      input: {
        id: 'gid://shopify/ProductVariant/gift_1',
        price: '0.00',
        compareAtPrice: '45',
      },
    })
    expect(shopifyRequests[2]?.variables).toMatchObject({
      metafields: [
        {
          ownerId: 'gid://shopify/Product/gift_product_1',
          namespace: 'palas',
          key: 'gift_only',
          type: 'boolean',
          value: 'true',
        },
      ],
    })
  })
})
