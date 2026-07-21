import { createHmac, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { withRuntimeDatabase } from './database'
import { readRuntimeState } from './state'

const state = readRuntimeState()
const unsubscribeSecret = 'runtime-smoke-unsubscribe-secret-0000000000000000000000000000'

function unsubscribeToken(email: string) {
  const body = Buffer.from(JSON.stringify({ e: email.toLowerCase(), v: 1 })).toString('base64url')
  const signature = createHmac('sha256', unsubscribeSecret).update(body).digest('base64url')
  return `${body}.${signature}`
}

test.describe('persisted Admin projections and consent', () => {
  test('deduplicates canonical event replay and records consent-blocked destinations', async ({ request }) => {
    const eventId = `runtime-event-${randomUUID()}`
    const event = {
      source: 'posthog_proxy',
      event_id: eventId,
      event_name: 'page_view',
      event_time: new Date().toISOString(),
      user: { muid: `runtime-muid-${randomUUID()}` },
      context: { url: 'https://fancypalas.com/collections/runtime', page_type: 'collection' },
      consent: {
        analytics_storage: true,
        ad_storage: false,
        ad_user_data: false,
        ad_personalization: false,
        source: 'runtime-certification',
      },
    }

    const send = () =>
      request.post(`${state.baseUrl}/api/event-hub/ingest`, {
        data: event,
        headers: { 'x-palas-ingest-token': 'runtime-smoke-ingest-token' },
      })

    const first = await send()
    if (first.status() !== 200) {
      const persistedAtFailure = await withRuntimeDatabase(async (client) => {
        const events = await client.query('SELECT event_id, valid FROM event_logs WHERE event_id = $1', [eventId])
        const dispatches = await client.query(
          'SELECT destination, status, attempt_count, error_code FROM dispatch_logs WHERE event_id = $1 ORDER BY destination',
          [eventId],
        )
        return { events: events.rows, dispatches: dispatches.rows }
      })
      throw new Error(
        `Event Hub ingest returned ${first.status()}: ${await first.text()}\nPersistence: ${JSON.stringify(persistedAtFailure)}`,
      )
    }
    const replay = await send()
    expect(replay.status(), await replay.text()).toBe(200)

    const persisted = await withRuntimeDatabase(async (client) => {
      const events = await client.query('SELECT event_id, valid FROM event_logs WHERE event_id = $1', [eventId])
      const dispatches = await client.query(
        'SELECT destination, status, event_destination_key FROM dispatch_logs WHERE event_id = $1 ORDER BY destination',
        [eventId],
      )
      return { events: events.rows, dispatches: dispatches.rows }
    })

    expect(persisted.events).toHaveLength(1)
    expect(new Set(persisted.dispatches.map((row) => row.event_destination_key)).size).toBe(persisted.dispatches.length)
    expect(persisted.dispatches).toEqual(
      expect.arrayContaining([expect.objectContaining({ destination: 'meta_capi', status: 'invalid' })]),
    )
  })

  test('rejects direct browser Event Hub bypass before persistence', async ({ request }) => {
    const eventId = `runtime-forbidden-${randomUUID()}`
    const response = await request.post(`${state.baseUrl}/api/event-hub/ingest`, {
      data: { source: 'posthog_proxy', event_id: eventId, event_name: 'page_view' },
      headers: {
        'x-palas-ingest-token': 'runtime-smoke-ingest-token',
        origin: 'https://fancypalas.com',
      },
    })
    expect(response.status()).toBe(410)

    const count = await withRuntimeDatabase(async (client) => {
      const result = await client.query('SELECT count(*)::int AS count FROM event_logs WHERE event_id = $1', [eventId])
      return result.rows[0].count as number
    })
    expect(count).toBe(0)
  })

  test('persists unsubscribe once and replays the one-click request idempotently', async ({ request }) => {
    const email = `runtime-unsubscribe-${randomUUID()}@example.test`
    await withRuntimeDatabase(async (client) => {
      await client.query(
        `INSERT INTO contacts
           (id, email, locale, klaviyo_subscribed, klaviyo_suppressed, created_at, updated_at)
         VALUES ($1, $2, 'fr-FR', true, false, now(), now())`,
        [randomUUID(), email],
      )
    })

    const token = unsubscribeToken(email)

    const first = await request.post(`${state.baseUrl}/api/contact/unsubscribe?t=${encodeURIComponent(token)}`)
    expect(first.status()).toBe(204)
    const firstTimestamp = await withRuntimeDatabase(async (client) => {
      const result = await client.query('SELECT email_marketing_opt_out_at FROM contacts WHERE email = $1', [email])
      return result.rows[0].email_marketing_opt_out_at as Date
    })
    expect(firstTimestamp).toBeTruthy()

    const replay = await request.post(`${state.baseUrl}/api/contact/unsubscribe?t=${encodeURIComponent(token)}`)
    expect(replay.status()).toBe(204)
    const replayedTimestamp = await withRuntimeDatabase(async (client) => {
      const result = await client.query('SELECT email_marketing_opt_out_at FROM contacts WHERE email = $1', [email])
      return result.rows[0].email_marketing_opt_out_at as Date
    })
    expect(replayedTimestamp.toISOString()).toBe(firstTimestamp.toISOString())

    const workflows = await withRuntimeDatabase(async (client) => {
      const result = await client.query(
        `SELECT command_name, status
           FROM workflow_runs
          ORDER BY started_at`,
      )
      return result.rows
    })
    expect(
      workflows.filter((workflow) =>
        ['cmd:markContactUnsubscribed', 'cmd:refreshContact'].includes(workflow.command_name),
      ).length,
      JSON.stringify(workflows),
    ).toBeGreaterThanOrEqual(3)
    expect(workflows.every((workflow) => workflow.status === 'succeeded')).toBe(true)
  })
})
