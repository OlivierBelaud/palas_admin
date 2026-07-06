import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const shopifyRequests: Array<{ query: string; variables: Record<string, unknown> }> = []
const originalToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

beforeEach(() => {
  vi.resetModules()
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
              price: '0.00',
              compareAtPrice: '45.00',
              product: {
                id: 'gid://shopify/Product/gift_product_1',
                metafield: { id: 'gid://shopify/Metafield/gift_only', value: 'true' },
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
  return (await import('../archive-marketing-rule')).default as unknown as {
    workflow: (input: Record<string, unknown>, context: Record<string, unknown>) => Promise<Record<string, unknown>>
  }
}

describe('archiveMarketingRule', () => {
  it('restores gift-only Shopify variant before archiving a gift rule', async () => {
    const command = await loadCommand()
    const update = vi.fn(async (id: string, data: Record<string, unknown>) => ({ id, ...data }))

    const row = await command.workflow(
      { id: 'gift_rule_1' },
      {
        step: {
          service: {
            marketingRule: {
              list: vi.fn(async () => [
                {
                  id: 'gift_rule_1',
                  rule_type: 'gift_threshold',
                  gift_product_id: 'gid://shopify/ProductVariant/gift_1',
                  payload: {
                    gift_original_price: 45,
                    gift_original_compare_at_price: null,
                  },
                },
              ]),
              update,
            },
          },
          emit: vi.fn(async () => undefined),
        },
        log: { warn: vi.fn() },
      },
    )

    expect(row.status).toBe('paused')
    expect(update).toHaveBeenCalledWith('gift_rule_1', expect.objectContaining({ status: 'paused' }))
    expect(shopifyRequests.map((request) => request.query)).toEqual([
      expect.stringContaining('PalasGiftVariant'),
      expect.stringContaining('PalasUpdateGiftVariant'),
      expect.stringContaining('PalasSetGiftOnlyMetafield'),
    ])
    expect(shopifyRequests[1]?.variables).toMatchObject({
      input: {
        id: 'gid://shopify/ProductVariant/gift_1',
        price: '45',
        compareAtPrice: null,
      },
    })
    expect(shopifyRequests[2]?.variables).toMatchObject({
      metafields: [
        {
          ownerId: 'gid://shopify/Product/gift_product_1',
          namespace: 'palas',
          key: 'gift_only',
          type: 'boolean',
          value: 'false',
        },
      ],
    })
  })
})
