import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import { loadLocalControl, parseControlRequest } from '../src/modules/tracking-control/local-query'
import type { RawDb } from '../src/utils/raw-db'

const url = process.env.CONTROL_TEST_DATABASE_URL

describe.skipIf(!url)('tracking control real PostgreSQL', () => {
  it('keeps half-open cohorts, retries, missing dispatches and send times distinct', async () => {
    if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
      throw new Error('Isolated local database required')
    const sql = postgres(url, { max: 1, prepare: false })
    try {
      await sql.unsafe(`CREATE TEMP TABLE event_logs (event_id text PRIMARY KEY, event_name text, received_at timestamptz, payload_normalized jsonb);
        CREATE TEMP TABLE dispatch_logs (event_id text, canonical_event_name text, destination text, status text, event_received_at timestamptz,
          last_attempt_at timestamptz, sent_at timestamptz, attempt_count int, http_status int, error_code text, response_payload jsonb,
          UNIQUE(event_id,destination));`)
      const ready = { validation: { destinations: { meta_capi: { supported: true, ready: true } } } }
      const blocked = { validation: { destinations: { meta_capi: { supported: true, ready: false } } } }
      for (const [id, at, payload] of [
        ['start', '2026-09-28T05:00:00Z', ready],
        ['missing', '2026-09-28T06:00:00Z', ready],
        ['blocked', '2026-09-28T07:00:00Z', blocked],
        ['end', '2026-09-28T12:00:00Z', ready],
        ['older', '2026-09-28T04:00:00Z', ready],
      ] as const) {
        await sql.unsafe('INSERT INTO event_logs VALUES ($1, $2, $3, $4::text::jsonb)', [
          id,
          'add_to_cart',
          at,
          JSON.stringify(payload),
        ])
      }
      await sql.unsafe(`INSERT INTO dispatch_logs VALUES
        ('start','add_to_cart','meta_capi','sent','2026-09-28T05:00:00Z','2026-09-28T08:00:00Z','2026-09-28T08:00:00Z',4,200,NULL,'{"events_received":1}'),
        ('blocked','add_to_cart','meta_capi','invalid','2026-09-28T07:00:00Z',NULL,NULL,0,NULL,'meta_capi_ad_storage_consent_not_granted',NULL),
        ('end','add_to_cart','meta_capi','sent','2026-09-28T12:00:00Z','2026-09-28T12:00:00Z','2026-09-28T12:00:00Z',1,200,NULL,'{"events_received":1}'),
        ('older','add_to_cart','meta_capi','sent','2026-09-28T04:00:00Z','2026-09-28T06:00:00Z','2026-09-28T06:00:00Z',1,200,NULL,'{"events_received":1}')`)
      const input = parseControlRequest(
        new URLSearchParams('destination=meta_capi&hours=7'),
        new Date('2026-09-28T12:00:00Z'),
      )
      const result = await loadLocalControl(input, {
        raw: (query, args) => sql.unsafe(query, args as never) as never,
      } as RawDb)
      expect(result.local.rows).toEqual([
        {
          event_name: 'add_to_cart',
          provider_event_name: 'AddToCart',
          captured: 3,
          eligible: 2,
          excluded: 1,
          unknown_eligibility: 0,
          missing_dispatch: 1,
          statuses: { sent: 1, invalid: 1 },
        },
      ])
      expect(result.local.sent_in_window).toEqual([
        { event_name: 'add_to_cart', provider_event_name: 'AddToCart', count: 2 },
      ])
      expect(result.local.receipt_count).toBe(2)
      expect(result.local.recent.find((row) => row.event_id === 'start')?.attempt_count).toBe(4)
    } finally {
      await sql.end()
    }
  })
})
