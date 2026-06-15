// Unit tests for `attributeSessionConversionCore` — the pure orchestration
// helper that backs the `attributeSessionConversion` command.
//
// Covers:
//   - happy path: session active at cart_birth_at → marked converted
//   - anonymous purchase (no distinct_id) → matched=0
//   - old cart converted in a later session → matched by conversion_at
//   - missing distinct_id → matched by email + conversion_at
//   - cart birthed before any session → matched=0
//   - cart birthed after last_event_at + 30min → matched=0
//   - multiple candidates → most recent started_at wins
//   - idempotent: already-converted session → matched=1 with no write
//   - update receives the order_id from input

import { describe, expect, it, vi } from 'vitest'
import {
  attributeSessionConversionCore,
  type SessionAttributionRepo,
  type SessionRow,
} from '../../../utils/attribute-session-conversion-helper'

const CART_BIRTH = '2026-05-12T10:00:00.000Z'
const CART_BIRTH_MS = new Date(CART_BIRTH).getTime()

function makeRepo(rows: SessionRow[]): SessionAttributionRepo & {
  updates: Array<{ id: string; patch: Record<string, unknown> }>
} {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
  return {
    list: vi.fn(async () => rows),
    update: vi.fn(async (id, patch) => {
      updates.push({ id, patch })
      return rows.find((r) => r.id === id) as SessionRow
    }),
    updates,
  }
}

function makeRepoWithEmail(
  rows: SessionRow[],
  emailRows: SessionRow[],
): SessionAttributionRepo & {
  updates: Array<{ id: string; patch: Record<string, unknown> }>
} {
  const repo = makeRepo(rows)
  return {
    ...repo,
    listByEmail: vi.fn(async () => emailRows),
  }
}

describe('attributeSessionConversionCore', () => {
  it('matches the session active at cart_birth_at (happy path)', async () => {
    const repo = makeRepo([
      {
        id: 'sess_a',
        started_at: new Date(CART_BIRTH_MS - 5 * 60_000), // 5min before cart birth
        last_event_at: new Date(CART_BIRTH_MS - 1 * 60_000),
        cart_converted: false,
        order_id: null,
      },
    ])
    const out = await attributeSessionConversionCore(
      { cart_birth_at: CART_BIRTH, distinct_id: 'd_1', order_id: 'order_42' },
      repo,
    )
    expect(out).toEqual({ matched: 1 })
    expect(repo.updates).toHaveLength(1)
    expect(repo.updates[0]).toEqual({
      id: 'sess_a',
      patch: {
        cart_converted: true,
        order_id: 'order_42',
        became_customer_in_session: true,
        became_customer_at: new Date(CART_BIRTH),
      },
    })
  })

  it('returns matched=0 when distinct_id is null', async () => {
    const repo = makeRepo([])
    const out = await attributeSessionConversionCore(
      { cart_birth_at: CART_BIRTH, distinct_id: null, order_id: null },
      repo,
    )
    expect(out).toEqual({ matched: 0 })
    expect(repo.list).not.toHaveBeenCalled()
  })

  it('falls back to conversion_at for an old cart converted during a later session', async () => {
    const conversionAt = '2026-05-22T10:05:00.000Z'
    const conversionMs = new Date(conversionAt).getTime()
    const repo = makeRepo([
      {
        id: 'sess_checkout',
        started_at: new Date(conversionMs - 10 * 60_000),
        last_event_at: new Date(conversionMs - 1 * 60_000),
        cart_converted: false,
        order_id: null,
        segment_at_session_start: 'known_no_purchase',
      },
    ])
    const out = await attributeSessionConversionCore(
      { cart_birth_at: CART_BIRTH, conversion_at: conversionAt, distinct_id: 'd_1', order_id: 'order_42' },
      repo,
    )
    expect(out).toEqual({ matched: 1 })
    expect(repo.updates[0]).toEqual({
      id: 'sess_checkout',
      patch: {
        cart_converted: true,
        order_id: 'order_42',
        became_customer_in_session: true,
        became_customer_at: new Date(conversionAt),
      },
    })
  })

  it('falls back to email plus conversion_at when the cart has no distinct_id', async () => {
    const conversionAt = '2026-05-22T10:05:00.000Z'
    const conversionMs = new Date(conversionAt).getTime()
    const repo = makeRepoWithEmail(
      [],
      [
        {
          id: 'sess_email',
          started_at: new Date(conversionMs - 20 * 60_000),
          last_event_at: new Date(conversionMs - 2 * 60_000),
          cart_converted: false,
          order_id: null,
          segment_at_session_start: 'known_no_purchase',
        },
      ],
    )
    const out = await attributeSessionConversionCore(
      {
        cart_birth_at: CART_BIRTH,
        conversion_at: conversionAt,
        distinct_id: null,
        email: 'CLIENT@EXAMPLE.COM ',
        order_id: 'order_43',
      },
      repo,
    )
    expect(out).toEqual({ matched: 1 })
    expect(repo.listByEmail).toHaveBeenCalledWith('client@example.com')
    expect(repo.updates[0].id).toBe('sess_email')
    expect(repo.updates[0].patch).toMatchObject({
      cart_converted: true,
      order_id: 'order_43',
      became_customer_at: new Date(conversionAt),
    })
  })

  it('returns matched=0 when distinct_id is empty string', async () => {
    const repo = makeRepo([])
    const out = await attributeSessionConversionCore(
      { cart_birth_at: CART_BIRTH, distinct_id: '', order_id: null },
      repo,
    )
    expect(out).toEqual({ matched: 0 })
  })

  it('returns matched=0 when no sessions exist for this distinct_id', async () => {
    const repo = makeRepo([])
    const out = await attributeSessionConversionCore(
      { cart_birth_at: CART_BIRTH, distinct_id: 'd_1', order_id: null },
      repo,
    )
    expect(out).toEqual({ matched: 0 })
    expect(repo.updates).toHaveLength(0)
  })

  it('returns matched=0 when cart birthed BEFORE the session started', async () => {
    const repo = makeRepo([
      {
        id: 'sess_a',
        started_at: new Date(CART_BIRTH_MS + 10 * 60_000), // started AFTER cart birth
        last_event_at: new Date(CART_BIRTH_MS + 15 * 60_000),
        cart_converted: false,
        order_id: null,
      },
    ])
    const out = await attributeSessionConversionCore(
      { cart_birth_at: CART_BIRTH, distinct_id: 'd_1', order_id: 'o' },
      repo,
    )
    expect(out).toEqual({ matched: 0 })
    expect(repo.updates).toHaveLength(0)
  })

  it('returns matched=0 when session last_event was >30min before cart_birth', async () => {
    const repo = makeRepo([
      {
        id: 'sess_a',
        started_at: new Date(CART_BIRTH_MS - 4 * 3600_000), // 4h before
        last_event_at: new Date(CART_BIRTH_MS - 35 * 60_000), // 35min before cart birth
        cart_converted: false,
        order_id: null,
      },
    ])
    const out = await attributeSessionConversionCore(
      { cart_birth_at: CART_BIRTH, distinct_id: 'd_1', order_id: 'o' },
      repo,
    )
    expect(out).toEqual({ matched: 0 })
  })

  it('matches a session whose last_event is within the 30min window', async () => {
    const repo = makeRepo([
      {
        id: 'sess_a',
        started_at: new Date(CART_BIRTH_MS - 60 * 60_000),
        last_event_at: new Date(CART_BIRTH_MS - 25 * 60_000), // 25min before — within window
        cart_converted: false,
        order_id: null,
      },
    ])
    const out = await attributeSessionConversionCore(
      { cart_birth_at: CART_BIRTH, distinct_id: 'd_1', order_id: 'o' },
      repo,
    )
    expect(out).toEqual({ matched: 1 })
  })

  it('most recent started_at wins when multiple sessions overlap', async () => {
    const repo = makeRepo([
      {
        id: 'sess_old',
        started_at: new Date(CART_BIRTH_MS - 60 * 60_000), // 1h before
        last_event_at: new Date(CART_BIRTH_MS - 5 * 60_000),
        cart_converted: false,
        order_id: null,
      },
      {
        id: 'sess_new',
        started_at: new Date(CART_BIRTH_MS - 10 * 60_000), // 10min before — more recent
        last_event_at: new Date(CART_BIRTH_MS - 1 * 60_000),
        cart_converted: false,
        order_id: null,
      },
    ])
    const out = await attributeSessionConversionCore(
      { cart_birth_at: CART_BIRTH, distinct_id: 'd_1', order_id: 'o' },
      repo,
    )
    expect(out).toEqual({ matched: 1 })
    expect(repo.updates).toHaveLength(1)
    expect(repo.updates[0].id).toBe('sess_new')
  })

  it('is idempotent: already-converted session returns matched=1 with no write', async () => {
    const repo = makeRepo([
      {
        id: 'sess_a',
        started_at: new Date(CART_BIRTH_MS - 5 * 60_000),
        last_event_at: new Date(CART_BIRTH_MS - 1 * 60_000),
        cart_converted: true,
        order_id: 'order_pre',
      },
    ])
    const out = await attributeSessionConversionCore(
      { cart_birth_at: CART_BIRTH, distinct_id: 'd_1', order_id: 'order_new' },
      repo,
    )
    expect(out).toEqual({ matched: 1 })
    expect(repo.updates).toHaveLength(0)
  })

  it('does not duplicate an order already stamped on another converted session', async () => {
    const repo = makeRepo([
      {
        id: 'sess_existing_order',
        started_at: new Date(CART_BIRTH_MS - 2 * 3600_000),
        last_event_at: new Date(CART_BIRTH_MS - 90 * 60_000),
        cart_converted: true,
        order_id: 'order_42',
      },
      {
        id: 'sess_candidate',
        started_at: new Date(CART_BIRTH_MS - 5 * 60_000),
        last_event_at: new Date(CART_BIRTH_MS - 1 * 60_000),
        cart_converted: false,
        order_id: null,
      },
    ])
    const out = await attributeSessionConversionCore(
      { cart_birth_at: CART_BIRTH, distinct_id: 'd_1', order_id: 'order_42' },
      repo,
    )
    expect(out).toEqual({ matched: 1 })
    expect(repo.updates).toHaveLength(0)
  })

  it('writes order_id=null when input.order_id is null', async () => {
    const repo = makeRepo([
      {
        id: 'sess_a',
        started_at: new Date(CART_BIRTH_MS - 5 * 60_000),
        last_event_at: new Date(CART_BIRTH_MS - 1 * 60_000),
        cart_converted: false,
        order_id: null,
      },
    ])
    const out = await attributeSessionConversionCore(
      { cart_birth_at: CART_BIRTH, distinct_id: 'd_1', order_id: null },
      repo,
    )
    expect(out).toEqual({ matched: 1 })
    expect(repo.updates[0].patch).toEqual({
      cart_converted: true,
      order_id: null,
      became_customer_in_session: true,
      became_customer_at: new Date(CART_BIRTH),
    })
  })

  it('ignores other-distinct-id sessions by passing distinct_id to the repo', async () => {
    const repo = makeRepo([])
    await attributeSessionConversionCore({ cart_birth_at: CART_BIRTH, distinct_id: 'wanted_id', order_id: null }, repo)
    expect(repo.list).toHaveBeenCalledWith({ distinct_id: 'wanted_id' })
  })
})
