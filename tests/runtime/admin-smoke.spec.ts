import { type APIRequestContext, expect, test } from '@playwright/test'
import { readRuntimeState } from './state'

const state = readRuntimeState()

async function realAdminToken(request: APIRequestContext) {
  const response = await request.post(`${state.baseUrl}/api/admin/login`, {
    data: { email: state.bootstrapAdmin.email, password: state.bootstrapAdmin.password },
  })
  expect(response.status()).toBe(200)
  return (await response.json()).token as string
}

async function catalogHandler(request: APIRequestContext) {
  process.env.DATABASE_URL = state.databaseUrl
  process.env.JWT_SECRET = 'test-secret-for-runtime-smoke'
  process.env.SHOPIFY_CATALOG_WRITES_ENABLED = 'false'
  const token = await realAdminToken(request)
  // @ts-expect-error The generated fast function is JavaScript and intentionally has no declaration file.
  const { default: handler } = await import('../../demo/commerce/vercel-fast-functions/admin-catalog-taxonomy.mjs')
  return {
    invoke: (data: Record<string, unknown>) =>
      handler.fetch(
        new Request('http://runtime.local/api/admin/catalog-taxonomy', {
          body: JSON.stringify(data),
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          method: 'POST',
        }),
      ),
  }
}

test.describe('admin runtime smoke', () => {
  test('authenticated home and infrastructure health render without errors', async ({ page }) => {
    const pageErrors: Error[] = []
    const successfulResponses: string[] = []

    page.on('pageerror', (error) => pageErrors.push(error))
    page.on('response', (response) => {
      const url = response.url()
      if (response.ok() && (url.includes('/admin/') || url.includes('/api/'))) {
        successfulResponses.push(`${response.status()} ${url}`)
      }
    })

    const response = await page.goto(`${state.baseUrl}/`, { waitUntil: 'networkidle', timeout: 30_000 })
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle('Admin')
    await expect(page.locator('#root')).not.toBeEmpty()
    await expect(page.getByText('Catalogue', { exact: true }).first()).toBeVisible()

    expect(pageErrors).toEqual([])
    expect(successfulResponses.length).toBeGreaterThan(0)

    const live = await page.request.get(`${state.baseUrl}/health/live`)
    expect(live.status()).toBe(200)

    const ready = await page.request.get(`${state.baseUrl}/health/ready`)
    expect(ready.status()).toBe(200)
    expect(await ready.json()).toMatchObject({ status: 'ready', checks: { db: 'ok' } })
  })

  test('catalog publication stays disabled until the production write gate is armed', async ({ request }) => {
    const { invoke } = await catalogHandler(request)
    const response = await invoke({ action: 'sync_shopify_collections' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: {
        shopify_sync: {
          ok: false,
          blocked: true,
          error: expect.stringContaining('SHOPIFY_CATALOG_WRITES_ENABLED'),
        },
      },
    })
  })

  test('catalog deletion remains replayable after the local soft-delete commits', async ({ request }) => {
    const { invoke } = await catalogHandler(request)

    const create = await invoke({ action: 'create_category', title_fr: 'Runtime retirement test' })
    expect(create.status).toBe(200)
    const categoryId = (await create.json()).data.result.id

    const firstDelete = await invoke({ action: 'delete_category', category_id: categoryId })
    expect(firstDelete.status).toBe(200)
    expect((await firstDelete.json()).data.result).toMatchObject({ id: categoryId })

    const replayedDelete = await invoke({ action: 'delete_category', category_id: categoryId })
    expect(replayedDelete.status).toBe(200)
    expect((await replayedDelete.json()).data.result).toMatchObject({ id: categoryId, already_deleted: true })
  })

  test('catalog navigation is read-only and renders its ownership boundary', async ({ page }) => {
    const mutations: string[] = []
    await page.route('**/api/admin/catalog-taxonomy', async (route) => {
      if (route.request().method() !== 'GET') {
        mutations.push(route.request().method())
        await route.abort()
        return
      }
      await route.fulfill({
        contentType: 'application/json',
        json: {
          data: {
            categories: [],
            products: [],
            summary: { products: 0, classified: 0, unclassified: 0, categories: 0 },
            publication: {
              allowed: false,
              runtime: 'preview',
              target: 'shopify-production',
              reason: 'Catalog publication is blocked in preview',
              pending: 0,
              synced: 0,
              failed: 0,
              conflicts: 0,
              retirements: 0,
            },
          },
        },
      })
    })

    await page.goto(`${state.baseUrl}/catalogue`, { waitUntil: 'networkidle' })

    await expect(page.getByText('Shopify reste la source des données produit', { exact: false })).toBeVisible()
    await expect(page.getByText('Publication Shopify désactivée par défaut', { exact: false })).toBeVisible()
    expect(mutations).toEqual([])
  })
})
