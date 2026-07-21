import { createHmac } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { readRuntimeState } from './state'

const state = readRuntimeState()

function adminToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      id: 'runtime-admin',
      actor_id: 'runtime-admin',
      auth_identity_id: 'runtime-admin-auth',
      type: 'admin',
      exp: Math.floor(Date.now() / 1000) + 300,
    }),
  ).toString('base64url')
  const signature = createHmac('sha256', 'test-secret-for-runtime-smoke')
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${signature}`
}

test.describe('admin-smoke', () => {
  test('admin home page renders without errors', async ({ page }) => {
    const pageErrors: Error[] = []
    const successfulResponses: string[] = []

    page.on('pageerror', (err) => pageErrors.push(err))
    page.on('response', (res) => {
      const url = res.url()
      const status = res.status()
      if (status >= 200 && status < 300 && (url.includes('/admin/') || url.includes('/api/'))) {
        successfulResponses.push(`${status} ${url}`)
      }
    })

    await page.context().addCookies([
      {
        name: 'manta.admin.access',
        value: adminToken(),
        url: state.baseUrl,
      },
    ])
    await page.addInitScript(() => localStorage.setItem('manta-auth-state', 'authenticated'))
    await page.route('**/api/admin/me', (route) =>
      route.fulfill({
        contentType: 'application/json',
        json: { data: { id: 'runtime-admin', email: 'runtime@example.com' } },
      }),
    )
    const response = await page.goto(`${state.baseUrl}/`, { waitUntil: 'networkidle', timeout: 30_000 })
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle('Admin')
    await expect(page.locator('#root')).not.toBeEmpty()
    await expect(page.getByText('Catalogue', { exact: true }).first()).toBeVisible()

    expect(pageErrors).toEqual([])
    expect(successfulResponses.length).toBeGreaterThan(0)

    // Verify /health/live directly
    const health = await page.request.get(`${state.baseUrl}/health/live`)
    expect(health.status()).toBe(200)

    // BC-F22 — /health/ready must report actual infra probes (db at least).
    const ready = await page.request.get(`${state.baseUrl}/health/ready`)
    expect(ready.status()).toBe(200)
    const readyBody = await ready.json()
    expect(readyBody.status).toBe('ready')
    expect(readyBody.checks).toBeDefined()
    expect(readyBody.checks.db).toBe('ok')
  })

  test('catalog publication stays disabled until the production write gate is explicitly armed', async () => {
    const modulePath = '../../demo/commerce/vercel-fast-functions/admin-catalog-taxonomy.mjs'
    const { default: handler } = await import(modulePath)
    const response = await handler.fetch(
      new Request('http://runtime.local/api/admin/catalog-taxonomy', {
        body: JSON.stringify({ action: 'sync_shopify_collections' }),
        headers: { authorization: `Bearer ${adminToken()}`, 'content-type': 'application/json' },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.shopify_sync).toMatchObject({
      ok: false,
      blocked: true,
      error: expect.stringContaining('SHOPIFY_CATALOG_WRITES_ENABLED'),
    })
  })

  test('catalog deletion remains replayable after the local soft-delete commits', async () => {
    const modulePath = '../../demo/commerce/vercel-fast-functions/admin-catalog-taxonomy.mjs'
    const { default: handler } = await import(modulePath)
    const invoke = (data: Record<string, unknown>) =>
      handler.fetch(
        new Request('http://runtime.local/api/admin/catalog-taxonomy', {
          body: JSON.stringify(data),
          headers: { authorization: `Bearer ${adminToken()}`, 'content-type': 'application/json' },
          method: 'POST',
        }),
      )
    const create = await invoke({ action: 'create_category', title_fr: 'Runtime retirement test' })
    expect(create.status).toBe(200)
    const categoryId = (await create.json()).data.result.id

    const firstDelete = await invoke({ action: 'delete_category', category_id: categoryId })
    expect(firstDelete.status).toBe(200)
    expect((await firstDelete.json()).data.result).toMatchObject({ id: categoryId })

    const replayedDelete = await invoke({ action: 'delete_category', category_id: categoryId })
    expect(replayedDelete.status).toBe(200)
    expect((await replayedDelete.json()).data.result).toMatchObject({
      id: categoryId,
      already_deleted: true,
    })
  })

  test('catalog navigation is read-only and renders its ownership boundary', async ({ page }) => {
    await page.context().addCookies([
      {
        name: 'manta.admin.access',
        value: adminToken(),
        url: state.baseUrl,
      },
    ])
    await page.addInitScript(() => localStorage.setItem('manta-auth-state', 'authenticated'))
    await page.route('**/api/admin/me', (route) =>
      route.fulfill({
        contentType: 'application/json',
        json: { data: { id: 'runtime-admin', email: 'runtime@example.com' } },
      }),
    )
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
