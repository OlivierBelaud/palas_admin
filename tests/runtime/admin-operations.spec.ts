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

    // This command is deliberately fail-closed when the Klaviyo projection is
    // missing or stale. Seed the exact runtime precondition so this smoke test
    // exercises command execution rather than the independent preflight guard.
    await withRuntimeDatabase(async (client) => {
      await client.query(`
        INSERT INTO klaviyo_projection_state (
          projection_key,
          generation,
          sync_token,
          status,
          last_attempted_at,
          requested_through,
          last_successful_at,
          covered_through,
          updated_at
        ) VALUES (
          'abandonment_events',
          1,
          'runtime-certification',
          'succeeded',
          date_trunc('second', NOW()),
          date_trunc('second', NOW()),
          NOW(),
          date_trunc('second', NOW()),
          NOW()
        )
        ON CONFLICT (projection_key) DO UPDATE SET
          generation = EXCLUDED.generation,
          sync_token = EXCLUDED.sync_token,
          status = EXCLUDED.status,
          last_attempted_at = EXCLUDED.last_attempted_at,
          requested_through = EXCLUDED.requested_through,
          last_successful_at = EXCLUDED.last_successful_at,
          covered_through = EXCLUDED.covered_through,
          last_error = NULL,
          consecutive_failures = 0,
          updated_at = EXCLUDED.updated_at
      `)
    })

    const dryRun = await request.post(`${state.baseUrl}/api/admin/command/notifyAbandonedCarts`, {
      data: { batchLimit: 1, dryRun: true },
    })
    const dryRunBody = await dryRun.json()
    expect([200, 202], JSON.stringify(dryRunBody)).toContain(dryRun.status())

    if (dryRun.status() === 200) {
      expect(dryRunBody).toMatchObject({
        data: {
          status: 'succeeded',
          result: {
            sent: 0,
            errors: 0,
          },
        },
      })
    } else {
      expect(dryRunBody).toMatchObject({ data: { status: 'running', runId: expect.any(String) } })
      const runId = dryRunBody.data.runId as string
      let terminal: Record<string, unknown> | null = null
      await expect
        .poll(
          async () => {
            const response = await request.get(`${state.baseUrl}/api/admin/_workflow/${encodeURIComponent(runId)}`)
            expect(response.status()).toBe(200)
            const body = await response.json()
            terminal = body.data
            return body.data.status
          },
          { timeout: 15_000 },
        )
        .toBe('succeeded')
      expect(terminal).toMatchObject({
        status: 'succeeded',
        output: {
          sent: 0,
          errors: 0,
        },
      })
    }

    const removedLegacySend = await request.post(`${state.baseUrl}/api/admin/command/sendAbandonedCartEmail`, {
      data: { cartId: 'runtime-certification', dryRun: true },
    })
    expect(removedLegacySend.status()).toBe(404)
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
