import { describe, expect, it } from 'vitest'
import { runAbandonedCartCampaign } from '../abandoned-cart-campaign'
import {
  assessKlaviyoProjectionFreshness,
  floorToSecond,
  type KlaviyoProjectionState,
  requireFreshKlaviyoProjection,
} from '../klaviyo-projection-state'

const NOW = new Date('2026-07-22T17:00:00.000Z')
const STATE_IDENTITY = {
  generation: 7,
  sync_token: 'sync_7',
  requested_through: NOW,
} as const

describe('Klaviyo projection freshness', () => {
  it.each<[KlaviyoProjectionState | null, string]>([
    [null, 'missing'],
    [
      {
        ...STATE_IDENTITY,
        status: 'syncing',
        last_attempted_at: NOW,
        last_successful_at: NOW,
        covered_through: NOW,
        last_error: null,
      },
      'syncing',
    ],
    [
      {
        ...STATE_IDENTITY,
        status: 'failed',
        last_attempted_at: NOW,
        last_successful_at: null,
        covered_through: null,
        last_error: 'PostHog unavailable',
      },
      'failed',
    ],
    [
      {
        ...STATE_IDENTITY,
        status: 'succeeded',
        last_attempted_at: NOW,
        last_successful_at: new Date(NOW.getTime() - 16 * 60_000),
        covered_through: new Date(NOW.getTime() - 16 * 60_000),
        last_error: null,
      },
      'stale',
    ],
  ])('rejects an unavailable projection (%s)', (state, reason) => {
    expect(assessKlaviyoProjectionFreshness(state, NOW, 15 * 60_000)).toMatchObject({ ready: false, reason })
  })

  it('accepts a successful watermark covering the current decision window', () => {
    expect(
      assessKlaviyoProjectionFreshness(
        {
          ...STATE_IDENTITY,
          status: 'succeeded',
          last_attempted_at: new Date(NOW.getTime() - 60_000),
          last_successful_at: new Date(NOW.getTime() - 60_000),
          covered_through: new Date(NOW.getTime() - 60_000),
          last_error: null,
        },
        NOW,
        15 * 60_000,
      ),
    ).toEqual({ ready: true, ageMs: 60_000 })
  })

  it('enforces the default 60-second fence without hiding millisecond truncation', () => {
    const atBoundary = {
      ...STATE_IDENTITY,
      status: 'succeeded' as const,
      last_attempted_at: new Date(NOW.getTime() - 60_000),
      last_successful_at: new Date(NOW.getTime() - 60_000),
      requested_through: new Date(NOW.getTime() - 60_000),
      covered_through: new Date(NOW.getTime() - 60_000),
      last_error: null,
    }

    expect(assessKlaviyoProjectionFreshness(atBoundary, NOW)).toEqual({ ready: true, ageMs: 60_000 })
    expect(assessKlaviyoProjectionFreshness(atBoundary, new Date(NOW.getTime() + 1))).toMatchObject({
      ready: false,
      reason: 'stale',
    })
    expect(floorToSecond(new Date('2026-07-22T17:00:00.987Z')).toISOString()).toBe('2026-07-22T17:00:00.000Z')
  })

  it('fails closed before campaign SQL continues when the watermark is stale', async () => {
    let calls = 0
    const sql = (async () => {
      calls += 1
      return [
        {
          ...STATE_IDENTITY,
          status: 'succeeded',
          last_attempted_at: NOW,
          last_successful_at: new Date(NOW.getTime() - 60 * 60_000),
          covered_through: new Date(NOW.getTime() - 60 * 60_000),
          last_error: null,
        },
      ]
    }) as never

    await expect(requireFreshKlaviyoProjection(sql, NOW)).rejects.toThrow('stale')
    expect(calls).toBe(1)
  })

  it('blocks the campaign before candidates or notification effects when the latest sync failed', async () => {
    let sqlCalls = 0
    let notificationCalls = 0
    const sql = (async () => {
      sqlCalls += 1
      return [
        {
          ...STATE_IDENTITY,
          status: 'failed',
          last_attempted_at: new Date(),
          last_successful_at: null,
          covered_through: null,
          last_error: 'PostHog unavailable',
        },
      ]
    }) as never

    await expect(
      runAbandonedCartCampaign({
        sql,
        notification: {
          send: async () => {
            notificationCalls += 1
            return { status: 'SUCCESS' as const }
          },
        },
        adminBase: 'https://admin.test',
        fromEmail: 'Palas <hello@palas.test>',
        log: { info: () => {}, warn: () => {}, error: () => {} },
      }),
    ).rejects.toThrow('failed')

    expect(sqlCalls).toBe(1)
    expect(notificationCalls).toBe(0)
  })
})
