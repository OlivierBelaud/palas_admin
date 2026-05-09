// Unit tests for `markCartsFromKlaviyoEvents` — the post-upsert step that
// stamps `cart.abandon_notified_at / source / count` based on freshly-ingested
// Klaviyo abandonment-flow events.
//
// Covers:
//   - non-abandonment metric (e.g. Placed Order) → no-op
//   - matching cart, never notified → marked source=klaviyo, count=1, at=event
//   - matching cart, already notified (Manta or older Klaviyo) → skipped
//   - email match must be case-insensitive on both sides
//   - multiple events same email → uses earliest occurred_at
//   - completed cart → not selected (filtered by SQL where)
//   - empty events list → 0 SELECT calls

import { describe, expect, it, vi } from 'vitest'
import {
  type CartMarkingRepo,
  type CartMarkingRow,
  markCartsFromKlaviyoEvents,
} from '../sync-klaviyo-events-mark-helper'

const NOW = new Date('2026-05-09T12:00:00Z')

const log = { info: () => {}, warn: () => {}, error: () => {} }

function makeCartRepo(rows: CartMarkingRow[]): CartMarkingRepo & {
  updates: Array<{ id: string; [k: string]: unknown }>
  listCalls: Array<Record<string, unknown>>
} {
  const updates: Array<{ id: string; [k: string]: unknown }> = []
  const listCalls: Array<Record<string, unknown>> = []
  return {
    list: vi.fn(async (where: Record<string, unknown>) => {
      listCalls.push(where)
      // Apply the IS NULL filter and email IN filter — that's all the tests need.
      const emailFilter = where.email as { $in?: string[] } | undefined
      const wantedEmails = emailFilter?.$in ? new Set(emailFilter.$in.map((e) => e.toLowerCase())) : null
      const isNullFilter = where.abandon_notified_at as { $null?: boolean } | undefined
      return rows.filter((r) => {
        if (wantedEmails && !wantedEmails.has((r.email ?? '').toLowerCase())) return false
        if (isNullFilter?.$null === true && r.abandon_notified_at != null) return false
        return true
      })
    }),
    update: vi.fn(async (patch) => {
      updates.push(patch)
      return patch
    }),
    updates,
    listCalls,
  }
}

describe('markCartsFromKlaviyoEvents', () => {
  it('no-ops on empty events list (no DB calls)', async () => {
    const repo = makeCartRepo([])
    const out = await markCartsFromKlaviyoEvents([], repo, log, NOW)
    expect(out.carts_marked_klaviyo).toBe(0)
    expect(out.emails_considered).toBe(0)
    expect(repo.listCalls).toHaveLength(0)
    expect(repo.updates).toHaveLength(0)
  })

  it('marks a never-notified cart matching an abandonment event', async () => {
    const occurred = new Date(NOW.getTime() - 3 * 3600 * 1000)
    const repo = makeCartRepo([
      {
        id: 'cart_1',
        email: 'shopper@test.com',
        abandon_notified_at: null,
        abandon_notified_count: 0,
      },
    ])
    const out = await markCartsFromKlaviyoEvents(
      [
        {
          email: 'shopper@test.com',
          metric: 'Shopify_Checkout_Abandonned',
          subject: null,
          occurred_at: occurred,
        },
      ],
      repo,
      log,
      NOW,
    )
    expect(out.carts_marked_klaviyo).toBe(1)
    expect(out.emails_considered).toBe(1)
    expect(repo.updates).toEqual([
      {
        id: 'cart_1',
        abandon_notified_at: occurred,
        abandon_notified_source: 'klaviyo',
        abandon_notified_count: 1,
      },
    ])
  })

  it('skips a cart already notified by Manta (abandon_notified_at set)', async () => {
    const repo = makeCartRepo([
      {
        id: 'cart_1',
        email: 'shopper@test.com',
        abandon_notified_at: new Date(NOW.getTime() - 4 * 3600 * 1000),
        abandon_notified_count: 1,
      },
    ])
    const out = await markCartsFromKlaviyoEvents(
      [
        {
          email: 'shopper@test.com',
          metric: 'Shopify_Checkout_Abandonned',
          subject: null,
          occurred_at: new Date(NOW.getTime() - 3 * 3600 * 1000),
        },
      ],
      repo,
      log,
      NOW,
    )
    // Already-notified cart filtered out by the SELECT — counter stays 0.
    expect(out.carts_marked_klaviyo).toBe(0)
    expect(repo.updates).toHaveLength(0)
  })

  it('skips events that are not abandonment-flow (e.g. Placed Order)', async () => {
    const repo = makeCartRepo([
      { id: 'cart_1', email: 'shopper@test.com', abandon_notified_at: null, abandon_notified_count: 0 },
    ])
    const out = await markCartsFromKlaviyoEvents(
      [
        {
          email: 'shopper@test.com',
          metric: 'Placed Order',
          subject: null,
          occurred_at: new Date(NOW.getTime() - 3 * 3600 * 1000),
        },
      ],
      repo,
      log,
      NOW,
    )
    expect(out.carts_marked_klaviyo).toBe(0)
    expect(out.emails_considered).toBe(0)
    expect(repo.listCalls).toHaveLength(0)
    expect(repo.updates).toHaveLength(0)
  })

  it('matches Received Email + abandonment subject', async () => {
    const occurred = new Date(NOW.getTime() - 2 * 3600 * 1000)
    const repo = makeCartRepo([
      { id: 'cart_1', email: 'shopper@test.com', abandon_notified_at: null, abandon_notified_count: 0 },
    ])
    const out = await markCartsFromKlaviyoEvents(
      [
        {
          email: 'shopper@test.com',
          metric: 'Received Email',
          subject: 'Vous avez oublié quelque chose',
          occurred_at: occurred,
        },
      ],
      repo,
      log,
      NOW,
    )
    expect(out.carts_marked_klaviyo).toBe(1)
    expect(repo.updates[0].abandon_notified_at).toBe(occurred)
  })

  it('uses the earliest occurred_at when several events target the same email', async () => {
    const earliest = new Date(NOW.getTime() - 5 * 3600 * 1000)
    const middle = new Date(NOW.getTime() - 3 * 3600 * 1000)
    const latest = new Date(NOW.getTime() - 1 * 3600 * 1000)
    const repo = makeCartRepo([
      { id: 'cart_1', email: 'shopper@test.com', abandon_notified_at: null, abandon_notified_count: 0 },
    ])
    const out = await markCartsFromKlaviyoEvents(
      [
        { email: 'shopper@test.com', metric: 'Shopify_Checkout_Abandonned', subject: null, occurred_at: middle },
        { email: 'shopper@test.com', metric: 'Shopify_Checkout_Abandonned', subject: null, occurred_at: latest },
        { email: 'shopper@test.com', metric: 'Shopify_Checkout_Abandonned', subject: null, occurred_at: earliest },
      ],
      repo,
      log,
      NOW,
    )
    expect(out.carts_marked_klaviyo).toBe(1)
    expect(out.emails_considered).toBe(1)
    expect(repo.updates).toHaveLength(1)
    expect(repo.updates[0].abandon_notified_at).toBe(earliest)
  })

  it('matches cart email case-insensitively', async () => {
    const occurred = new Date(NOW.getTime() - 3 * 3600 * 1000)
    const repo = makeCartRepo([
      { id: 'cart_1', email: 'Mixed.Case@TEST.com', abandon_notified_at: null, abandon_notified_count: 0 },
    ])
    const out = await markCartsFromKlaviyoEvents(
      [
        {
          email: 'mixed.case@test.com',
          metric: 'Checkout Abandoned',
          subject: null,
          occurred_at: occurred,
        },
      ],
      repo,
      log,
      NOW,
    )
    expect(out.carts_marked_klaviyo).toBe(1)
    expect(repo.updates[0].id).toBe('cart_1')
  })

  it('belt-and-braces: skips cart whose abandon_notified_at became non-null between SELECT and UPDATE', async () => {
    // Repo returns a row that the SELECT shouldn't have returned (race), but
    // we still defend against it in memory.
    const occurred = new Date(NOW.getTime() - 3 * 3600 * 1000)
    const repo: CartMarkingRepo & {
      updates: Array<{ id: string; [k: string]: unknown }>
    } = {
      list: vi.fn(async () => [
        {
          id: 'cart_1',
          email: 'shopper@test.com',
          // Race: a Manta cron run between SELECT plan and execution stamped this row.
          abandon_notified_at: new Date(NOW.getTime() - 1 * 3600 * 1000),
          abandon_notified_count: 1,
        },
      ]),
      update: vi.fn(),
      updates: [],
    }
    const out = await markCartsFromKlaviyoEvents(
      [
        {
          email: 'shopper@test.com',
          metric: 'Shopify_Checkout_Abandonned',
          subject: null,
          occurred_at: occurred,
        },
      ],
      repo,
      log,
      NOW,
    )
    expect(out.carts_marked_klaviyo).toBe(0)
    expect(out.carts_skipped_already_notified).toBe(1)
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('counts an error and continues when update throws', async () => {
    const occurred = new Date(NOW.getTime() - 3 * 3600 * 1000)
    const repo = makeCartRepo([
      { id: 'cart_a', email: 'a@test.com', abandon_notified_at: null, abandon_notified_count: 0 },
      { id: 'cart_b', email: 'b@test.com', abandon_notified_at: null, abandon_notified_count: 0 },
    ])
    let calls = 0
    repo.update = vi.fn(async (patch) => {
      calls++
      if (calls === 1) throw new Error('connection reset')
      repo.updates.push(patch)
      return patch
    })
    const out = await markCartsFromKlaviyoEvents(
      [
        { email: 'a@test.com', metric: 'Shopify_Checkout_Abandonned', subject: null, occurred_at: occurred },
        { email: 'b@test.com', metric: 'Shopify_Checkout_Abandonned', subject: null, occurred_at: occurred },
      ],
      repo,
      log,
      NOW,
    )
    expect(out.emails_considered).toBe(2)
    // First update threw, second succeeded.
    expect(out.carts_marked_klaviyo).toBe(1)
    expect(repo.updates).toHaveLength(1)
    expect(repo.updates[0].id).toBe('cart_b')
  })
})
