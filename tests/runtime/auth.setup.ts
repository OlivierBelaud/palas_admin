import { expect, test } from '@playwright/test'
import { RUNTIME_AUTH_PATH, readRuntimeState } from './state'

const state = readRuntimeState()

test('bootstrap a real admin session through invitation acceptance', async ({ page }) => {
  const admin = state.bootstrapAdmin

  await page.goto(`${state.baseUrl}/accept-invite?token=${encodeURIComponent(admin.inviteToken)}`)
  await page.getByPlaceholder('First name').fill('Runtime')
  await page.getByPlaceholder('Last name').fill('Admin')
  await page.getByPlaceholder('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page).toHaveURL(/\/login$/)

  const replay = await page.request.post(`${state.baseUrl}/api/admin/accept-invite`, {
    data: { token: admin.inviteToken, password: admin.password },
  })
  expect(replay.status()).toBe(409)

  await page.getByPlaceholder('Email').fill(admin.email)
  await page.getByPlaceholder('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Continue with Email' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)

  const me = await page.request.get(`${state.baseUrl}/api/admin/me`)
  expect(me.status()).toBe(200)
  expect(await me.json()).toMatchObject({ data: { email: admin.email } })

  await page.context().storageState({ path: RUNTIME_AUTH_PATH })
})
