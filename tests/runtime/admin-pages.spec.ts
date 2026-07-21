import { expect, test } from '@playwright/test'
import { readRuntimeState } from './state'

const state = readRuntimeState()

const pageContracts = [
  { path: '/dashboard', landmark: 'Dashboard' },
  { path: '/paniers', landmark: 'Paniers' },
  { path: '/orders', landmark: 'Commandes' },
  { path: '/catalogue', landmark: 'Architecture du catalogue' },
  { path: '/catalogue/homepage', landmark: 'Composition de la homepage' },
  { path: '/catalogue/menu', landmark: 'Navigation du storefront' },
  { path: '/marketing-rules', landmark: 'Marketing rules' },
  {
    path: '/marketing-simulator',
    landmark: 'Impossible de charger les donnees Shopify du simulateur',
  },
  { path: '/clients', landmark: 'Clients' },
  { path: '/emails', landmark: 'Relances paniers abandonnés' },
  { path: '/charts-lab', landmark: 'Charts lab' },
  { path: '/visitor-lifecycle', landmark: 'Lifecycle visiteurs' },
  { path: '/visitor-stats', landmark: 'Visitor stats' },
  { path: '/tracking-health', landmark: 'Tracking health' },
  { path: '/settings', landmark: 'Settings' },
  { path: '/settings/users', landmark: 'Acces admin' },
  { path: '/discounts', landmark: 'Discounts boutique' },
  { path: '/discounts/individual', landmark: 'Individual discounts' },
  { path: '/paniers-abandonnes', landmark: 'Paniers abandonnés' },
  { path: '/paniers-abandonnes/emails', landmark: 'Relances paniers abandonnés' },
  { path: '/paniers-abandonnes/checks', landmark: 'Checks paniers abandonnés' },
  { path: '/customer-groups', landmark: 'Customer Groups' },
] as const

test.describe('admin SPA journey matrix', () => {
  test('renders at least twenty critical pages from loading into their operator landmark', async ({ page }) => {
    expect(pageContracts.length).toBeGreaterThanOrEqual(20)
    const criticalQueryPaths = ['/api/admin/cart-stats', '/api/admin/visitor-lifecycle-dashboard']
    const successfulCriticalQueries = new Set<string>()
    const failedCriticalQueries: string[] = []
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname
      if (!criticalQueryPaths.includes(path)) return
      if (response.ok()) successfulCriticalQueries.add(path)
      else failedCriticalQueries.push(`${response.status()} ${path}`)
    })

    for (const contract of pageContracts) {
      const pageErrors: string[] = []
      const onPageError = (error: Error) => pageErrors.push(error.message)
      page.on('pageerror', onPageError)

      const response = await page.goto(`${state.baseUrl}${contract.path}`, {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      })
      expect(response?.status(), contract.path).toBe(200)
      await expect(page.getByText(contract.landmark, { exact: false }).first(), contract.path).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.locator('#root'), contract.path).not.toBeEmpty()
      expect(pageErrors, contract.path).toEqual([])

      page.off('pageerror', onPageError)
    }

    expect(failedCriticalQueries).toEqual([])
    expect([...successfulCriticalQueries].sort()).toEqual([...criticalQueryPaths].sort())
  })

  test('surfaces a provider error and keeps the safe primary refresh action usable', async ({ page }) => {
    await page.goto(`${state.baseUrl}/marketing-simulator`)
    await expect(page.getByText('SHOPIFY_ADMIN_ACCESS_TOKEN not set', { exact: false })).toBeVisible()

    await page.goto(`${state.baseUrl}/paniers-abandonnes`)
    await expect(page.getByRole('heading', { name: 'Paniers abandonnés' })).toBeVisible()
    await page.getByRole('button', { name: /Actualiser|Refresh/i }).click()
    await expect(page.getByRole('heading', { name: 'Paniers abandonnés' })).toBeVisible()
  })
})
