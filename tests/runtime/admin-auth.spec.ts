import { type APIRequestContext, type Browser, expect, test } from '@playwright/test'
import { readRuntimeState } from './state'

const state = readRuntimeState()
const emptyStorageState = { cookies: [], origins: [] }

async function createInvite(request: APIRequestContext, prefix: string) {
  const email = `${prefix}-${Date.now()}@example.test`
  const response = await request.post(`${state.baseUrl}/api/admin/invitations`, {
    data: { action: 'create', email },
  })
  expect(response.status()).toBe(201)
  const invite = (await response.json()).data as { invite_url: string; email_send_status: string }
  expect(invite.invite_url).toMatch(new RegExp(`^${state.baseUrl}/accept-invite\\?token=`))
  expect(invite.email_send_status).toBe('PENDING')
  return { email, inviteUrl: invite.invite_url, token: new URL(invite.invite_url).searchParams.get('token') ?? '' }
}

async function acceptInvite(browser: Browser, inviteUrl: string, password: string) {
  const context = await browser.newContext({ storageState: emptyStorageState })
  const page = await context.newPage()
  await page.goto(inviteUrl)
  await page.getByPlaceholder('First name').fill('Journey')
  await page.getByPlaceholder('Last name').fill('Admin')
  await page.getByPlaceholder('Password').fill(password)
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page).toHaveURL(/\/login$/)
  return { context, page }
}

test.describe('real admin access lifecycle', () => {
  test('denies unauthenticated pages and protected APIs', async ({ browser }) => {
    const context = await browser.newContext({ storageState: emptyStorageState })
    const page = await context.newPage()

    const response = await context.request.get(`${state.baseUrl}/api/admin/invitations`)
    expect(response.status()).toBe(401)

    await page.goto(`${state.baseUrl}/settings/users`)
    await expect(page).toHaveURL(/\/login$/)
    await context.close()
  })

  test('settings creates an invite that can be accepted, refreshed, logged out, and revoked', async ({
    browser,
    page,
    request,
  }) => {
    await page.goto(`${state.baseUrl}/settings/users`)
    await expect(page.getByRole('heading', { name: 'Acces admin' })).toBeVisible()

    const invited = await createInvite(request, 'runtime-revocation')
    const password = 'Runtime-revocation-354!'
    const invitedSession = await acceptInvite(browser, invited.inviteUrl, password)

    await invitedSession.page.getByPlaceholder('Email').fill(invited.email)
    await invitedSession.page.getByPlaceholder('Password').fill(password)
    await invitedSession.page.getByRole('button', { name: 'Continue with Email' }).click()
    await expect(invitedSession.page).toHaveURL(/\/dashboard$/)

    const beforeRefresh = await invitedSession.context.cookies(state.baseUrl)
    const refreshCookie = beforeRefresh.find((cookie) => cookie.name === 'manta.admin.refresh')
    expect(refreshCookie?.value).toBeTruthy()

    const refresh = await invitedSession.context.request.post(`${state.baseUrl}/api/admin/refresh`)
    expect(refresh.status()).toBe(200)

    const logout = await invitedSession.context.request.delete(`${state.baseUrl}/api/admin/logout`)
    expect(logout.status()).toBe(200)
    expect(await logout.json()).toMatchObject({ success: true, revoked: true })

    const revokedRefresh = await request.post(`${state.baseUrl}/api/admin/refresh`, {
      data: { refreshToken: refreshCookie?.value },
    })
    expect(revokedRefresh.status()).toBe(401)

    await invitedSession.context.close()
  })

  test('password reset consumes the cache token and invalidates the old password', async ({ browser, request }) => {
    const invited = await createInvite(request, 'runtime-reset')
    const oldPassword = 'Runtime-reset-old-354!'
    const newPassword = 'Runtime-reset-new-354!'
    const invitedSession = await acceptInvite(browser, invited.inviteUrl, oldPassword)
    await invitedSession.context.close()

    const resetRequest = await request.post(`${state.baseUrl}/api/admin/forgot-password`, {
      data: { email: invited.email },
    })
    expect(resetRequest.status()).toBe(200)

    const cacheResponse = await fetch(state.cacheUrl, {
      body: JSON.stringify(['GET', `auth:reset:admin:${invited.email}`]),
      headers: { authorization: `Bearer ${state.cacheToken}`, 'content-type': 'application/json' },
      method: 'POST',
    })
    const resetToken = (await cacheResponse.json()).result as string
    expect(resetToken).toBeTruthy()

    const resetContext = await browser.newContext({ storageState: emptyStorageState })
    const resetPage = await resetContext.newPage()
    await resetPage.goto(
      `${state.baseUrl}/reset-password?email=${encodeURIComponent(invited.email)}&token=${encodeURIComponent(resetToken)}`,
    )
    await resetPage.getByPlaceholder('Nouveau mot de passe').fill(newPassword)
    await resetPage.getByRole('button', { name: 'Mettre à jour le mot de passe' }).click()
    await expect(resetPage.getByText('Mot de passe mis à jour', { exact: false })).toBeVisible()

    const oldLogin = await request.post(`${state.baseUrl}/api/admin/login`, {
      data: { email: invited.email, password: oldPassword },
    })
    expect(oldLogin.status()).toBe(401)
    const newLogin = await request.post(`${state.baseUrl}/api/admin/login`, {
      data: { email: invited.email, password: newPassword },
    })
    expect(newLogin.status()).toBe(200)

    const consumed = await fetch(state.cacheUrl, {
      body: JSON.stringify(['GET', `auth:reset:admin:${invited.email}`]),
      headers: { authorization: `Bearer ${state.cacheToken}`, 'content-type': 'application/json' },
      method: 'POST',
    })
    expect((await consumed.json()).result).toBeNull()
    await resetContext.close()
  })

  test('rejects an invalid invitation token', async ({ request }) => {
    const response = await request.post(`${state.baseUrl}/api/admin/accept-invite`, {
      data: { token: 'missing-runtime-token', password: 'Runtime-invalid-354!' },
    })
    expect(response.status()).toBe(404)
  })
})
