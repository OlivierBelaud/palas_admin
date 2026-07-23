import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import {
  buildDailyReportPayload,
  resumeDailyReportDeliveries,
  sendDailyReportEmail,
} from '../src/utils/daily-reporting'
import type { RuntimeNotificationPort, RuntimeSql } from '../src/utils/manta-runtime'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('daily reporting contract (PostgreSQL)', () => {
  it('uses one paid-order and traffic cohort contract across reporting metrics', async () => {
    const admin = postgres(databaseUrl as string, { max: 1 })
    const schema = `daily_reporting_${crypto.randomUUID().replaceAll('-', '')}`

    try {
      await admin.unsafe(`CREATE SCHEMA "${schema}"`)
      await admin.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL search_path TO "${schema}"`)
        await createReportingSchema(tx as unknown as RuntimeSql)
        await seedReportingMatrix(tx as unknown as RuntimeSql)

        const payload = await buildDailyReportPayload(tx as unknown as RuntimeSql, {
          day: '2026-06-16',
          now: new Date('2026-06-17T03:00:00.000Z'),
        })

        expect(payload.period).toEqual({
          start_utc: '2026-06-15T22:00:00.000Z',
          end_utc: '2026-06-16T22:00:00.000Z',
        })
        expect(payload.summary).toMatchObject({
          sessions: 4,
          unique_visitors: 3,
          orders: 2,
          revenue: 150,
          sold_countries_count: 2,
          session_conversion_rate: 0.5,
          visitor_conversion_rate: 1 / 3,
          unattributed_orders: 0,
        })
        expect(payload.countries.map(({ country_code, orders }) => ({ country_code, orders }))).toEqual([
          { country_code: 'FR', orders: 1 },
          { country_code: 'US', orders: 1 },
        ])

        const totalSegment = payload.segments.find((row) => row.segment === 'total')
        expect(totalSegment).toMatchObject({ orders: 2, revenue: 150, session_conversion_rate: 0.5 })
        expect(totalSegment?.visitor_conversion_rate).toBe(1 / 3)

        const lifecycleChannel = payload.channel_segments.find(
          (row) => row.segment === 'total' && row.channel === 'Email relance panier / lifecycle',
        )
        expect(lifecycleChannel?.unique_visitors).toBe(2)

        expect(payload.cart_summary).toMatchObject({
          carts_created: 2,
          carts_created_converted: 2,
          carts_created_conversion_rate: 1,
          total_cart_visitors: 2,
          total_cart_converted: 1,
          total_cart_conversion_rate: 0.5,
        })
        expect(payload.cart_birth_segments.find((row) => row.segment === 'total')).toMatchObject({
          carts_born: 2,
          orders_same_day: 2,
          revenue_same_day: 150,
        })
        expect(payload.cart_activity_segments.find((row) => row.segment === 'total')).toMatchObject({
          sessions: 4,
          order_sessions: 2,
        })

        const email1 = payload.abandoned_cart_emails.find((row) => row.message_type === 'abandoned_cart_1')
        expect(email1).toMatchObject({
          sent: 2,
          clicks: 1,
          click_rate: 0.5,
          conversions: 1,
          conversion_rate: 0.5,
          revenue: 100,
        })
      })
    } finally {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })

  it('isolates recipients and resumes each durable delivery exactly once', async () => {
    const admin = postgres(databaseUrl as string, { max: 1 })
    const workerA = postgres(databaseUrl as string, { max: 1 })
    const workerB = postgres(databaseUrl as string, { max: 1 })
    const schema = `daily_delivery_${crypto.randomUUID().replaceAll('-', '')}`

    try {
      await admin.unsafe(`CREATE SCHEMA "${schema}"`)
      await admin.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL search_path TO "${schema}"`)
        await createReportingSchema(tx as unknown as RuntimeSql)
        await seedReportingMatrix(tx as unknown as RuntimeSql)
        const sql = tx as unknown as RuntimeSql
        const firstCalls: string[] = []
        const firstNotification: RuntimeNotificationPort = {
          async send(message) {
            firstCalls.push(message.to)
            if (message.to === 'a@example.com') throw new Error('provider timeout')
            if (message.to === 'b@example.com') return { status: 'PENDING', id: 'pending-b' }
            if (message.to === 'd@example.com') return { status: 'FAILURE', error: new Error('invalid recipient') }
            return { status: 'SUCCESS', id: 'sent-c' }
          },
        }

        const first = await sendDailyReportEmail({
          sql,
          notification: firstNotification,
          day: '2026-06-16',
          now: new Date('2026-06-17T03:00:00.000Z'),
          recipients: ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'],
        })

        expect(firstCalls).toEqual(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'])
        expect(first.sent.map(({ to, delivery_status }) => ({ to, delivery_status }))).toEqual([
          { to: 'a@example.com', delivery_status: 'reconciliation_required' },
          { to: 'b@example.com', delivery_status: 'reconciliation_required' },
          { to: 'c@example.com', delivery_status: 'succeeded' },
          { to: 'd@example.com', delivery_status: 'failed' },
        ])
        await sql.unsafe(
          `UPDATE reporting_daily_deliveries
           SET next_attempt_at = NOW() - INTERVAL '1 second'
           WHERE recipient IN ('a@example.com', 'b@example.com', 'd@example.com')`,
        )

        const retryCalls: string[] = []
        const retry = await sendDailyReportEmail({
          sql,
          notification: {
            async send(message) {
              retryCalls.push(message.to)
              return { status: 'SUCCESS', id: `retry-${message.to}` }
            },
          },
          day: '2026-06-16',
          now: new Date('2026-06-17T04:00:00.000Z'),
          recipients: ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'],
        })

        expect(retryCalls).toEqual(['a@example.com', 'b@example.com', 'd@example.com'])
        expect(retry.sent.every((row) => row.delivery_status === 'succeeded')).toBe(true)
        const deliveries = await sql.unsafe<Array<{ recipient: string; status: string; attempt_count: number }>>(
          `SELECT recipient, status, attempt_count
           FROM reporting_daily_deliveries
           ORDER BY recipient`,
        )
        expect(deliveries).toEqual([
          { recipient: 'a@example.com', status: 'succeeded', attempt_count: 2 },
          { recipient: 'b@example.com', status: 'succeeded', attempt_count: 2 },
          { recipient: 'c@example.com', status: 'succeeded', attempt_count: 1 },
          { recipient: 'd@example.com', status: 'succeeded', attempt_count: 2 },
        ])
      })

      await workerA.unsafe(`SET search_path TO "${schema}"`)
      await workerB.unsafe(`SET search_path TO "${schema}"`)
      await verifyIndependentDeliveryClaims(workerA as unknown as RuntimeSql, workerB as unknown as RuntimeSql)
    } finally {
      await workerA.end()
      await workerB.end()
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })
})

async function verifyIndependentDeliveryClaims(workerA: RuntimeSql, workerB: RuntimeSql): Promise<void> {
  let concurrentProviderCalls = 0
  const concurrentNotification: RuntimeNotificationPort = {
    async send() {
      concurrentProviderCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 25))
      return { status: 'SUCCESS', id: 'sent-once' }
    },
  }
  const common = {
    notification: concurrentNotification,
    day: '2026-06-16',
    now: new Date('2026-06-17T05:00:00.000Z'),
    recipients: ['concurrent@example.com'],
  }
  const concurrent = await Promise.all([
    sendDailyReportEmail({ ...common, sql: workerA }),
    sendDailyReportEmail({ ...common, sql: workerB }),
  ])

  expect(concurrentProviderCalls).toBe(1)
  expect(concurrent.flatMap((result) => result.sent).some((row) => row.delivery_status === 'succeeded')).toBe(true)
  const [concurrentRow] = await workerA.unsafe<Array<{ status: string; attempt_count: number }>>(
    `SELECT status, attempt_count FROM reporting_daily_deliveries WHERE recipient = 'concurrent@example.com'`,
  )
  expect(concurrentRow).toEqual({ status: 'succeeded', attempt_count: 1 })

  let markFirstProviderStarted: (() => void) | undefined
  const firstProviderStarted = new Promise<void>((resolve) => {
    markFirstProviderStarted = resolve
  })
  let releaseFirstProvider: ((result: { status: 'SUCCESS'; id: string }) => void) | undefined
  const firstProviderResult = new Promise<{ status: 'SUCCESS'; id: string }>((resolve) => {
    releaseFirstProvider = resolve
  })
  const staleAttempt = sendDailyReportEmail({
    sql: workerA,
    notification: {
      async send() {
        markFirstProviderStarted?.()
        return firstProviderResult
      },
    },
    day: '2026-06-16',
    now: new Date('2026-06-17T05:10:00.000Z'),
    recipients: ['stale@example.com'],
  })
  await firstProviderStarted
  await workerB.unsafe(
    `UPDATE reporting_daily_deliveries
     SET claim_expires_at = NOW() - INTERVAL '1 second'
     WHERE recipient = 'stale@example.com'`,
  )
  const successor = await sendDailyReportEmail({
    sql: workerB,
    notification: {
      async send() {
        return { status: 'SUCCESS', id: 'successor' }
      },
    },
    day: '2026-06-16',
    now: new Date('2026-06-17T05:11:00.000Z'),
    recipients: ['stale@example.com'],
  })
  releaseFirstProvider?.({ status: 'SUCCESS', id: 'stale-worker' })
  const stale = await staleAttempt
  expect(successor.sent[0]).toMatchObject({ delivery_status: 'succeeded', id: 'successor' })
  expect(stale.sent[0]).toMatchObject({ delivery_status: 'succeeded', id: 'successor' })
  const [fencedRow] = await workerA.unsafe<
    Array<{ status: string; attempt_count: number; provider_message_id: string }>
  >(
    `SELECT status, attempt_count, provider_message_id
     FROM reporting_daily_deliveries
     WHERE recipient = 'stale@example.com'`,
  )
  expect(fencedRow).toEqual({ status: 'succeeded', attempt_count: 2, provider_message_id: 'successor' })

  await sendDailyReportEmail({
    sql: workerA,
    notification: {
      async send() {
        return { status: 'FAILURE', error: new Error('temporary') }
      },
    },
    day: '2026-06-15',
    now: new Date('2026-06-16T05:00:00.000Z'),
    recipients: ['backlog@example.com'],
  })
  await workerA.unsafe(
    `UPDATE reporting_daily_deliveries
     SET next_attempt_at = NOW() - INTERVAL '1 second'
     WHERE recipient = 'backlog@example.com'`,
  )
  let backlogCalls = 0
  const resumed = await resumeDailyReportDeliveries({
    sql: workerB,
    notification: {
      async send() {
        backlogCalls += 1
        return { status: 'SUCCESS', id: 'backlog-resumed' }
      },
    },
  })
  expect(backlogCalls).toBe(1)
  expect(resumed.sent).toEqual([
    expect.objectContaining({ to: 'backlog@example.com', delivery_status: 'succeeded', id: 'backlog-resumed' }),
  ])

  const ambiguousAttemptKeys: string[] = []
  const ambiguous = await sendDailyReportEmail({
    sql: workerA,
    notification: {
      async send(message) {
        ambiguousAttemptKeys.push(message.idempotency_key ?? '')
        throw new Error('provider response lost')
      },
    },
    day: '2026-06-16',
    now: new Date('2026-06-17T05:20:00.000Z'),
    recipients: ['current-day@example.com'],
  })
  expect(ambiguous.sent[0]).toMatchObject({ delivery_status: 'reconciliation_required' })

  const [snapshotBeforeRecovery] = await workerA.unsafe<Array<{ payload: unknown; updated_at: string }>>(
    `SELECT payload, updated_at::text
     FROM reporting_daily_snapshots
     WHERE day = '2026-06-16' AND timezone = 'Europe/Paris' AND deleted_at IS NULL`,
  )

  let earlyRetryCalls = 0
  const earlyRetry = await resumeDailyReportDeliveries({
    sql: workerB,
    notification: {
      async send() {
        earlyRetryCalls += 1
        return { status: 'SUCCESS', id: 'too-early' }
      },
    },
  })
  expect(earlyRetryCalls).toBe(0)
  expect(earlyRetry.sent).toEqual([])

  await workerA.unsafe(
    `UPDATE reporting_daily_deliveries
     SET next_attempt_at = NOW() - INTERVAL '1 second'
     WHERE recipient = 'current-day@example.com'`,
  )
  let concurrentRecoveryCalls = 0
  const recoveryNotification: RuntimeNotificationPort = {
    async send(message) {
      concurrentRecoveryCalls += 1
      ambiguousAttemptKeys.push(message.idempotency_key ?? '')
      await new Promise((resolve) => setTimeout(resolve, 25))
      return { status: 'SUCCESS', id: 'current-day-recovered' }
    },
  }
  const recoveries = await Promise.all([
    resumeDailyReportDeliveries({ sql: workerA, notification: recoveryNotification }),
    resumeDailyReportDeliveries({ sql: workerB, notification: recoveryNotification }),
  ])
  expect(concurrentRecoveryCalls).toBe(1)
  expect(new Set(ambiguousAttemptKeys)).toEqual(new Set(['daily-report:2026-06-16:current-day@example.com']))
  expect(recoveries.flatMap(({ sent }) => sent)).toContainEqual(
    expect.objectContaining({
      to: 'current-day@example.com',
      delivery_status: 'succeeded',
      id: 'current-day-recovered',
    }),
  )

  const replay = await resumeDailyReportDeliveries({
    sql: workerA,
    notification: recoveryNotification,
  })
  expect(concurrentRecoveryCalls).toBe(1)
  expect(replay.sent).toEqual([])

  const [snapshotAfterRecovery] = await workerA.unsafe<Array<{ payload: unknown; updated_at: string }>>(
    `SELECT payload, updated_at::text
     FROM reporting_daily_snapshots
     WHERE day = '2026-06-16' AND timezone = 'Europe/Paris' AND deleted_at IS NULL`,
  )
  expect(snapshotAfterRecovery).toEqual(snapshotBeforeRecovery)

  await sendDailyReportEmail({
    sql: workerA,
    notification: {
      async send() {
        return { status: 'FAILURE', error: new Error('permanent') }
      },
    },
    day: '2026-06-14',
    now: new Date('2026-06-15T05:00:00.000Z'),
    recipients: ['exhausted@example.com'],
  })
  await workerA.unsafe(
    `UPDATE reporting_daily_deliveries
     SET attempt_count = 5, next_attempt_at = NOW() - INTERVAL '1 second'
     WHERE recipient = 'exhausted@example.com'`,
  )
  let exhaustedCalls = 0
  const exhausted = await resumeDailyReportDeliveries({
    sql: workerB,
    notification: {
      async send() {
        exhaustedCalls += 1
        return { status: 'SUCCESS', id: 'must-not-send' }
      },
    },
  })
  expect(exhaustedCalls).toBe(0)
  expect(exhausted.sent).toEqual([])
}

async function createReportingSchema(sql: RuntimeSql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE visitor_sessions (
      id text PRIMARY KEY,
      distinct_id text NOT NULL,
      started_at timestamptz NOT NULL,
      last_event_at timestamptz NOT NULL,
      deleted_at timestamptz,
      order_id text,
      segment_at_session_start text,
      first_url text,
      utm_source text,
      utm_medium text,
      utm_campaign text,
      referring_domain text,
      is_paid_session boolean NOT NULL DEFAULT false,
      carts_created_in_session integer NOT NULL DEFAULT 0,
      carts_updated_in_session integer NOT NULL DEFAULT 0,
      carts_viewed_in_session integer NOT NULL DEFAULT 0
    );
    CREATE TABLE orders (
      id text PRIMARY KEY,
      shopify_order_id text,
      status text NOT NULL,
      financial_status text,
      total_price numeric NOT NULL,
      include_in_ecommerce_analytics boolean NOT NULL DEFAULT true,
      placed_at timestamptz NOT NULL,
      deleted_at timestamptz,
      shipping_country_code text,
      shipping_country_name text
    );
    CREATE TABLE carts (
      id text PRIMARY KEY,
      distinct_id text,
      email text,
      shopify_order_id text,
      cart_birth_at timestamptz,
      created_at timestamptz NOT NULL,
      deleted_at timestamptz
    );
    CREATE TABLE cart_order (cart_id text NOT NULL, order_id text NOT NULL, deleted_at timestamptz);
    CREATE TABLE abandoned_cart_messages (
      id text PRIMARY KEY,
      message_type text NOT NULL,
      status text NOT NULL,
      sent_at timestamptz,
      deleted_at timestamptz
    );
    CREATE TABLE abandoned_cart_cases (
      id text PRIMARY KEY,
      recovered_source_message_id text,
      recovered_order_id text,
      recovered_amount numeric,
      recovered_at timestamptz,
      deleted_at timestamptz
    );
  `)
  const snapshotMigration = await readFile(
    new URL('../drizzle/migrations/20260615121000_reporting_daily_snapshots.sql', import.meta.url),
    'utf8',
  )
  const deliveryMigration = await readFile(
    new URL('../drizzle/migrations/20260722180000_reporting_daily_deliveries.sql', import.meta.url),
    'utf8',
  )
  await sql.unsafe(snapshotMigration)
  await sql.unsafe(deliveryMigration)
}

async function seedReportingMatrix(sql: RuntimeSql): Promise<void> {
  await sql.unsafe(`
    INSERT INTO visitor_sessions
      (id, distinct_id, started_at, last_event_at, order_id, segment_at_session_start, first_url, utm_source,
       carts_created_in_session, carts_updated_in_session, carts_viewed_in_session)
    VALUES
      ('s1', 'visitor-a', '2026-06-16T08:00:00Z', '2026-06-16T08:30:00Z', 'shop-paid', 'unknown', 'https://fancypalas.com/', 'direct', 1, 1, 1),
      ('s2', 'visitor-a', '2026-06-16T10:00:00Z', '2026-06-16T10:30:00Z', 'shop-fulfilled', 'returning_customer', 'https://fancypalas.com/', 'google', 0, 1, 0),
      ('s3', 'visitor-b', '2026-06-16T12:00:00Z', '2026-06-16T12:30:00Z', 'shop-pending', 'known_no_purchase',
       'https://fancypalas.com/?palas_email_type=abandoned_cart&palas_email_message_id=msg-today-1&utm_content=abandoned_cart_1',
       'palas_crm', 1, 0, 1),
      ('s-yesterday-email', 'visitor-old', '2026-06-16T13:00:00Z', '2026-06-16T13:05:00Z', NULL, 'unknown',
       'https://fancypalas.com/?palas_email_type=abandoned_cart&palas_email_message_id=msg-yesterday&utm_content=abandoned_cart_1',
       'palas_crm', 0, 0, 0),
      ('s-tomorrow', 'visitor-c', '2026-06-17T08:00:00Z', '2026-06-17T08:05:00Z', NULL, 'unknown',
       'https://fancypalas.com/?palas_email_type=abandoned_cart&palas_email_message_id=msg-today-2&utm_content=abandoned_cart_1',
       'palas_crm', 0, 0, 0);

    INSERT INTO orders
      (id, shopify_order_id, status, financial_status, total_price, include_in_ecommerce_analytics, placed_at,
       shipping_country_code, shipping_country_name)
    VALUES
      ('o-paid', 'shop-paid', 'paid', 'paid', 100, true, '2026-06-16T08:20:00Z', 'FR', 'France'),
      ('o-fulfilled', 'shop-fulfilled', 'fulfilled', 'paid', 50, true, '2026-06-16T10:20:00Z', 'US', 'Etats-Unis'),
      ('o-pending', 'shop-pending', 'pending', 'pending', 900, true, '2026-06-16T11:00:00Z', 'GB', 'Royaume-Uni'),
      ('o-cancelled', 'shop-cancelled', 'cancelled', 'paid', 800, true, '2026-06-16T12:00:00Z', 'DE', 'Allemagne'),
      ('o-refunded', 'shop-refunded', 'refunded', 'refunded', 700, true, '2026-06-16T13:00:00Z', 'ES', 'Espagne'),
      ('o-excluded', 'shop-excluded', 'paid', 'paid', 600, false, '2026-06-16T14:00:00Z', 'IT', 'Italie');

    INSERT INTO carts (id, distinct_id, email, shopify_order_id, cart_birth_at, created_at)
    VALUES
      ('c1', 'visitor-a', 'a@example.com', 'shop-paid', '2026-06-16T07:50:00Z', '2026-06-16T07:50:00Z'),
      ('c2', 'visitor-b', 'b@example.com', 'shop-fulfilled', '2026-06-16T09:50:00Z', '2026-06-16T09:50:00Z');
    INSERT INTO cart_order (cart_id, order_id) VALUES ('c1', 'o-paid'), ('c2', 'o-fulfilled'), ('c2', 'o-fulfilled');

    INSERT INTO abandoned_cart_messages (id, message_type, status, sent_at)
    VALUES
      ('msg-today-1', 'abandoned_cart_1', 'sent', '2026-06-16T07:00:00Z'),
      ('msg-today-2', 'abandoned_cart_1', 'sent', '2026-06-16T09:00:00Z'),
      ('msg-yesterday', 'abandoned_cart_1', 'sent', '2026-06-15T07:00:00Z');
    INSERT INTO abandoned_cart_cases (id, recovered_source_message_id, recovered_order_id, recovered_amount, recovered_at)
    VALUES
      ('recovered-today', 'msg-today-1', 'shop-paid', 100, '2026-06-16T18:00:00Z'),
      ('recovered-excluded', 'msg-today-2', 'shop-excluded', 600, '2026-06-16T19:00:00Z'),
      ('recovered-late', 'msg-today-2', 'shop-fulfilled', 50, '2026-06-17T08:00:00Z');
  `)
}
