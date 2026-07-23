import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ShopifyAdminTransportError,
  resolveShopifyAdminConfig,
  shopifyAdminGraphql,
  shopifyAdminJson,
  shopifyAdminRequest,
} from './shopify-admin-transport.mjs'

const options = {
  domain: 'example.myshopify.com',
  token: 'secret-token',
  apiVersion: '2099-01',
  retryDelayMs: 0,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Shopify Admin transport', () => {
  it('is the only source of a pinned Shopify Admin API version', () => {
    const root = resolve(import.meta.dirname, '..')
    const sourceFiles = ['src', 'scripts', 'vercel-fast-functions'].flatMap(function walk(relative): string[] {
      return readdirSync(resolve(root, relative), { withFileTypes: true }).flatMap((entry) => {
        const child = `${relative}/${entry.name}`
        if (entry.isDirectory()) return walk(child)
        return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) ? [child] : []
      })
    })

    for (const sourceFile of sourceFiles) {
      if (sourceFile.includes('shopify-admin-transport.')) continue
      expect(readFileSync(resolve(root, sourceFile), 'utf8'), sourceFile).not.toMatch(
        /(?:admin\/api\/|SHOPIFY_ADMIN_API_VERSION\s*=\s*['"])20\d{2}-\d{2}/,
      )
    }
  })

  it('centralizes endpoint configuration and fails closed without authentication', () => {
    expect(resolveShopifyAdminConfig(options, {})).toMatchObject({
      endpoint: 'https://example.myshopify.com/admin/api/2099-01',
      token: 'secret-token',
    })
    expect(() => resolveShopifyAdminConfig({}, {})).toThrowError(
      expect.objectContaining({ kind: 'authentication', retryable: false }),
    )
  })

  it.each([
    [401, 'authentication', false],
    [403, 'authentication', false],
    [404, 'not_found', false],
    [429, 'rate_limited', true],
    [503, 'upstream', true],
  ] as const)('classifies HTTP %s as %s', async (status, kind, retryable) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('provider detail', { status })),
    )

    await expect(shopifyAdminRequest('orders/1.json', {}, options)).rejects.toMatchObject({
      kind,
      retryable,
      status,
    })
  })

  it('times out a provider call with a typed retryable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string, init: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
          }),
      ),
    )

    await expect(shopifyAdminRequest('orders/1.json', {}, { ...options, timeoutMs: 5 })).rejects.toMatchObject({
      kind: 'timeout',
      retryable: true,
    })
  })

  it('does not mark an ambiguous GraphQL timeout as retryable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException('provider timeout', 'TimeoutError')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(shopifyAdminGraphql('mutation Test { test }', {}, options)).rejects.toMatchObject({
      kind: 'outcome_unknown',
      retryable: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('covers response body timeouts and retries only a safe read', async () => {
    const bodyTimeout = {
      ok: true,
      json: async () => {
        throw new DOMException('body timeout', 'AbortError')
      },
    } as Response
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bodyTimeout)
      .mockResolvedValueOnce(Response.json({ order: { id: 1 } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await shopifyAdminJson<{ order: { id: number } }>(
      'orders/1.json',
      {},
      { ...options, maxAttempts: 2 },
    )

    expect(result.data.order.id).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries safe reads after 429 but does not silently retry mutations', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(Response.json({ order: { id: 1 } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await shopifyAdminJson<{ order: { id: number } }>(
      'orders/1.json',
      {},
      { ...options, maxAttempts: 2 },
    )
    expect(result.data.order.id).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await expect(
      shopifyAdminRequest('graphql.json', { method: 'POST' }, { ...options, maxAttempts: 2 }),
    ).rejects.toMatchObject({ kind: 'configuration' })
  })

  it('rejects invalid JSON and malformed GraphQL envelopes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not-json', { status: 200 })),
    )
    await expect(shopifyAdminJson('orders.json', {}, options)).rejects.toMatchObject({
      kind: 'invalid_response',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ errors: [{ message: 'denied' }] })),
    )
    await expect(shopifyAdminGraphql('query Test { shop { id } }', {}, options)).rejects.toMatchObject({
      kind: 'graphql',
    })
  })

  it('always injects the configured access token', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await shopifyAdminRequest('shop.json', {}, options)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.myshopify.com/admin/api/2099-01/shop.json',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Shopify-Access-Token': 'secret-token' }),
      }),
    )
  })

  it('never forwards Admin credentials outside the configured API origin and version', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(shopifyAdminRequest('https://attacker.example/orders.json', {}, options)).rejects.toMatchObject({
      kind: 'configuration',
    })
    await expect(
      shopifyAdminRequest('https://example.myshopify.com/admin/api/2024-10/orders.json', {}, options),
    ).rejects.toMatchObject({ kind: 'configuration' })
    await expect(
      shopifyAdminRequest('https://example.myshopify.com:8443/admin/api/2099-01/orders.json', {}, options),
    ).rejects.toMatchObject({ kind: 'configuration' })
    await expect(
      shopifyAdminRequest('https://example.myshopify.com/admin/api/2099-010/orders.json', {}, options),
    ).rejects.toMatchObject({ kind: 'configuration' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ShopifyAdminTransportError', () => {
  it('remains identifiable across consumer boundaries', () => {
    expect(new ShopifyAdminTransportError('not_found', 'missing')).toBeInstanceOf(ShopifyAdminTransportError)
  })
})
