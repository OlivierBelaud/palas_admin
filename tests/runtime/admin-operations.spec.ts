import { expect, test } from '@playwright/test'
import { withRuntimeDatabase } from './database'
import { readRuntimeState } from './state'

const state = readRuntimeState()

test.describe('Admin operational boundaries', () => {
  test('protects command execution and loads the engagement command graph', async ({ browser, request }) => {
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const anonymousRequest = anonymous.request
    const denied = await anonymousRequest.post(`${state.baseUrl}/api/admin/command/notifyAbandonedCarts`, {
      data: { batchLimit: 1, dryRun: true },
    })
    expect(denied.status()).toBe(401)
    await anonymous.close()

    const dryRun = await request.post(`${state.baseUrl}/api/admin/command/notifyAbandonedCarts`, {
      data: { batchLimit: 1, dryRun: true },
    })
    const dryRunBody = await dryRun.json()
    expect(dryRun.status(), JSON.stringify(dryRunBody)).toBe(200)
    expect(dryRunBody).toMatchObject({
      data: {
        status: 'succeeded',
        result: {
          sent: 0,
          errors: 0,
        },
      },
    })
  })

  test('requires the cron secret before resolving a job name', async ({ request }) => {
    const missing = await request.get(`${state.baseUrl}/api/crons/runtime-certification-unknown`)
    expect(missing.status()).toBe(401)

    const invalid = await request.get(`${state.baseUrl}/api/crons/runtime-certification-unknown`, {
      headers: { authorization: 'Bearer wrong-secret' },
    })
    expect(invalid.status()).toBe(401)

    const authorized = await request.get(`${state.baseUrl}/api/crons/runtime-certification-unknown`, {
      headers: { authorization: 'Bearer runtime-smoke-cron-secret' },
    })
    expect(authorized.status()).toBe(404)
  })

  test('materializes the framework recovery schema in the application migration chain', async () => {
    const tables = await withRuntimeDatabase(async (client) => {
      const result = await client.query(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('workflow_runs', 'workflow_progress')
          ORDER BY table_name`,
      )
      return result.rows.map((row) => row.table_name)
    })

    expect(tables).toEqual(['workflow_progress', 'workflow_runs'])
  })
})
