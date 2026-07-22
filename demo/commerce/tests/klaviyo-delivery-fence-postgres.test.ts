import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import { fenceDeliveryAgainstKlaviyoProjection } from '../src/utils/abandoned-cart-campaign'
import type { RuntimeSql } from '../src/utils/manta-runtime'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('Klaviyo delivery fence (PostgreSQL)', () => {
  it('atomically rejects successor claims, unhealthy projections, staleness and late local events', async () => {
    const parsedUrl = new URL(databaseUrl as string)
    const socketHost = parsedUrl.searchParams.get('host')
    const admin = socketHost?.startsWith('/')
      ? postgres({
          host: socketHost,
          database: parsedUrl.pathname.slice(1),
          username: decodeURIComponent(parsedUrl.username),
          password: decodeURIComponent(parsedUrl.password),
          max: 1,
        })
      : postgres(databaseUrl as string, { max: 1 })
    const schema = `klaviyo_fence_${crypto.randomUUID().replaceAll('-', '')}`

    try {
      await admin.unsafe(`CREATE SCHEMA "${schema}"`)
      await admin.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL search_path TO "${schema}"`)
        await tx.unsafe(`
          CREATE TABLE abandoned_cart_messages (
            id text PRIMARY KEY,
            delivery_claim_token text,
            delivery_claimed_at timestamptz,
            status text NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT NOW()
          );
          CREATE TABLE klaviyo_projection_state (
            projection_key text PRIMARY KEY,
            generation bigint NOT NULL,
            sync_token text NOT NULL,
            status text NOT NULL,
            last_successful_at timestamptz,
            requested_through timestamptz NOT NULL,
            covered_through timestamptz
          );
          CREATE TABLE klaviyo_events (
            email text NOT NULL,
            metric text NOT NULL,
            subject text,
            occurred_at timestamptz NOT NULL
          )`)
        const through = new Date(Math.floor(Date.now() / 1000) * 1000)
        const fence = { generation: 7, syncToken: 'sync_7', throughIso: through.toISOString() }
        const sql = tx as unknown as RuntimeSql
        const authorize = (deliveryFence = fence) =>
          fenceDeliveryAgainstKlaviyoProjection(
            sql,
            { messageId: 'message_1', claimToken: 'claim_original' },
            deliveryFence,
            'shopper@test.com',
            new Date(through.getTime() - 60 * 60_000),
          )

        await tx.unsafe(
          `INSERT INTO abandoned_cart_messages (id, delivery_claim_token, status)
           VALUES ('message_1', 'claim_original', 'pending')`,
        )
        await tx.unsafe(
          `INSERT INTO klaviyo_projection_state
             (projection_key, generation, sync_token, status, last_successful_at, requested_through, covered_through)
           VALUES ('abandonment_events', 7, 'sync_7', 'succeeded', $1, $1, $1)`,
          [through],
        )

        expect(await authorize()).toBe(true)

        await tx.unsafe("UPDATE abandoned_cart_messages SET delivery_claim_token = 'claim_successor'")
        expect(await authorize()).toBe(false)
        await tx.unsafe("UPDATE abandoned_cart_messages SET delivery_claim_token = 'claim_original'")

        for (const status of ['syncing', 'failed']) {
          await tx.unsafe('UPDATE klaviyo_projection_state SET status = $1', [status])
          expect(await authorize()).toBe(false)
        }

        const staleThrough = new Date(Math.floor((Date.now() - 2 * 60_000) / 1000) * 1000)
        const staleFence = { ...fence, throughIso: staleThrough.toISOString() }
        await tx.unsafe(
          "UPDATE klaviyo_projection_state SET status = 'succeeded', requested_through = $1, covered_through = $1",
          [staleThrough],
        )
        expect(await authorize(staleFence)).toBe(false)

        await tx.unsafe(
          `UPDATE klaviyo_projection_state
           SET requested_through = $1, covered_through = $1, last_successful_at = $1`,
          [through],
        )
        await tx.unsafe(
          `INSERT INTO klaviyo_events (email, metric, subject, occurred_at)
           VALUES ('shopper@test.com', 'Received Email', 'Votre sélection de bijoux Palas vous attend', $1)`,
          [through],
        )
        expect(await authorize()).toBe(false)
      })
    } finally {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })
})
