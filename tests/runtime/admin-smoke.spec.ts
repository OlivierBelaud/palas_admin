import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const state = JSON.parse(readFileSync('tests/runtime/.state.json', 'utf8')) as {
  skipped: boolean
  reason?: string
  baseUrl?: string
}

test.describe('admin-smoke', () => {
  test.skip(state.skipped, state.reason ?? 'runtime smoke skipped')

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

    const response = await page.goto(`${state.baseUrl}/admin/`, { waitUntil: 'networkidle', timeout: 30_000 })
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle('Admin')
    await expect(page.locator('#root')).not.toBeEmpty()
    await expect(page.getByText('Commerce Admin', { exact: false })).toBeVisible()

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
})
