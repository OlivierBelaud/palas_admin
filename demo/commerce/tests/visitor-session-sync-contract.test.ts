import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const runVisitorSessionSync = vi.fn(async () => ({
  fetched: 0,
  attempted: 0,
  skipped: 0,
  errors: 0,
  since: '2026-07-23T09:00:00.000Z',
  max_at: null,
  attribution_repaired: 0,
  remaining_unattributed_recent: 0,
  duration_ms: 1,
}))

vi.mock('../src/utils/visitor-session-sync', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/utils/visitor-session-sync')>()
  return {
    ...original,
    runVisitorSessionSync,
  }
})

beforeAll(() => {
  vi.stubGlobal('defineCommand', (definition: unknown) => definition)
  vi.stubGlobal('defineJob', (name: string, schedule: string, handler: unknown) => ({ name, schedule, handler }))
  vi.stubGlobal(
    'z',
    {
      object: () => ({}),
      number: () => ({
        min: () => ({
          max: () => ({
            optional: () => ({}),
          }),
        }),
      }),
    },
  )
  vi.stubGlobal(
    'MantaError',
    class MantaError extends Error {
      constructor(
        readonly code: string,
        message: string,
        readonly details?: unknown,
      ) {
        super(message)
      }
    },
  )
})

beforeEach(() => {
  runVisitorSessionSync.mockClear()
  process.env.POSTHOG_API_KEY = 'posthog-private'
  process.env.NODE_ENV = 'production'
})

describe('syncVisitorSessions entrypoint contract', () => {
  it('routes the manual command through the canonical engine', async () => {
    const command = (await import('../src/commands/admin/sync-visitor-sessions')).default as unknown as {
      workflow: (
        input: { lookbackMinutes?: number },
        context: { step: { action: typeof action }; log: Console },
      ) => Promise<unknown>
    }
    const db = { raw: vi.fn() }
    const signal = new AbortController().signal

    await command.workflow(
      { lookbackMinutes: 30 },
      {
        step: { action },
        log: console,
      },
    )

    expect(runVisitorSessionSync).toHaveBeenCalledOnce()
    expect(runVisitorSessionSync).toHaveBeenCalledWith({
      db,
      privateKey: 'posthog-private',
      lookbackMinutes: 30,
      signal,
      log: console,
    })

    function action(
      _name: string,
      definition: {
        invoke: (input: unknown, context: { app: { resolve: () => unknown }; signal: AbortSignal }) => Promise<unknown>
      },
    ) {
      return () => definition.invoke(undefined, { app: { resolve: () => db }, signal })
    }
  })

  it('routes the scheduled job through the same canonical engine and defaults', async () => {
    const job = (await import('../src/jobs/sync-visitor-sessions')).default as unknown as {
      name: string
      schedule: string
      handler: (context: { db: unknown; log: Console }) => Promise<unknown>
    }
    const db = { raw: vi.fn() }

    await job.handler({ db, log: console })

    expect(job).toMatchObject({ name: 'sync-visitor-sessions', schedule: '*/5 * * * *' })
    expect(runVisitorSessionSync).toHaveBeenCalledOnce()
    expect(runVisitorSessionSync).toHaveBeenCalledWith({
      db,
      privateKey: 'posthog-private',
      log: console,
    })
  })

  it('preserves the manual command full-day replay default', async () => {
    const command = (await import('../src/commands/admin/sync-visitor-sessions')).default as unknown as {
      workflow: (
        input: { lookbackMinutes?: number },
        context: { step: { action: typeof action }; log: Console },
      ) => Promise<unknown>
    }
    const db = { raw: vi.fn() }
    const signal = new AbortController().signal

    await command.workflow(
      {},
      {
        step: { action },
        log: console,
      },
    )

    expect(runVisitorSessionSync).toHaveBeenCalledWith(
      expect.objectContaining({
        lookbackMinutes: 24 * 60,
      }),
    )

    function action(
      _name: string,
      definition: {
        invoke: (input: unknown, context: { app: { resolve: () => unknown }; signal: AbortSignal }) => Promise<unknown>
      },
    ) {
      return () => definition.invoke(undefined, { app: { resolve: () => db }, signal })
    }
  })

  it('surfaces cancellation from the canonical engine as WORKFLOW_CANCELLED', async () => {
    const command = (await import('../src/commands/admin/sync-visitor-sessions')).default as unknown as {
      workflow: (
        input: { lookbackMinutes?: number },
        context: { step: { action: typeof action }; log: Console },
      ) => Promise<unknown>
    }
    const db = { raw: vi.fn() }
    const controller = new AbortController()
    runVisitorSessionSync.mockImplementationOnce(async () => {
      controller.abort()
      return {
        fetched: 0,
        attempted: 0,
        skipped: 0,
        errors: 0,
        since: '2026-07-23T09:00:00.000Z',
        max_at: null,
        attribution_repaired: 0,
        remaining_unattributed_recent: 0,
        duration_ms: 1,
      }
    })

    await expect(
      command.workflow(
        {},
        {
          step: { action },
          log: console,
        },
      ),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { code: 'WORKFLOW_CANCELLED' },
    })

    function action(
      _name: string,
      definition: {
        invoke: (input: unknown, context: { app: { resolve: () => unknown }; signal: AbortSignal }) => Promise<unknown>
      },
    ) {
      return () => definition.invoke(undefined, { app: { resolve: () => db }, signal: controller.signal })
    }
  })
})

describe('canonical visitor-session sync engine', () => {
  it('paginates with a stable timestamp/uuid cursor and extracts checkout email', async () => {
    const { createVisitorSessionSyncEngine } = await import('../src/utils/visitor-session-sync')
    const queries: string[] = []
    const pages: Array<
      Array<readonly [uuid: string, event: string, distinctId: string, timestamp: string, properties: object]>
    > = [
      [
        ['uuid-1', 'checkout:started', 'distinct-1', '2026-07-23T09:00:01.000Z', { $session_id: 'session-1' }],
        [
          'uuid-2',
          'checkout:started',
          'distinct-2',
          '2026-07-23T09:00:02.000Z',
          { $session_id: 'session-2', checkout: { email: 'buyer@example.com' } },
        ],
      ],
      [],
    ]
    const query = vi.fn(async (hogql: string) => {
      queries.push(hogql)
      return pages.shift() ?? []
    })
    const db = createRuntimeDb()
    const repairAttribution = vi.fn(async () => ({
      candidate_orders: 4,
      repaired_orders: 2,
      remaining_unattributed_orders: 3,
    }))
    const run = createVisitorSessionSyncEngine({
      query,
      repairAttribution,
      nowMs: () => Date.parse('2026-07-23T10:00:00.000Z'),
    })

    const result = await run({
      db,
      privateKey: 'posthog-private',
      eventsPerPage: 2,
      maxPages: 3,
      lookbackMinutes: 15,
      log: console,
    })

    expect(query).toHaveBeenCalledTimes(2)
    expect(queries[0]).toContain("timestamp > toDateTime('2026-07-23T09:00:00.000Z')")
    expect(queries[1]).toContain("timestamp > toDateTime('2026-07-23T09:00:02.000Z')")
    expect(queries[1]).toContain("uuid > 'uuid-2'")
    expect(db.upserts).toHaveLength(2)
    expect(db.upserts[1]?.emailAtSessionStart).toBe('buyer@example.com')
    expect(repairAttribution).toHaveBeenCalledWith(
      expect.objectContaining({ unsafe: expect.any(Function) }),
      {
        startIso: '2026-07-21T10:00:00.000Z',
        endIso: '2026-07-23T11:00:00.000Z',
      },
    )
    expect(result).toMatchObject({
      fetched: 2,
      attempted: 2,
      skipped: 0,
      errors: 0,
      attribution_repaired: 2,
      remaining_unattributed_recent: 3,
    })
  })

  it('stops before finalization and attribution repair when cancelled', async () => {
    const { createVisitorSessionSyncEngine } = await import('../src/utils/visitor-session-sync')
    const signal = new AbortController()
    signal.abort()
    const query = vi.fn(async () => [])
    const repairAttribution = vi.fn(async () => ({
      candidate_orders: 0,
      repaired_orders: 0,
      remaining_unattributed_orders: 0,
    }))
    const db = createRuntimeDb()
    const run = createVisitorSessionSyncEngine({
      query,
      repairAttribution,
      nowMs: () => Date.parse('2026-07-23T10:00:00.000Z'),
    })

    const result = await run({
      db,
      privateKey: 'posthog-private',
      signal: signal.signal,
      log: console,
    })

    expect(query).not.toHaveBeenCalled()
    expect(repairAttribution).not.toHaveBeenCalled()
    expect(db.maxTimestampReads).toBe(1)
    expect(result).toMatchObject({
      fetched: 0,
      attempted: 0,
      errors: 0,
      max_at: null,
      attribution_repaired: 0,
    })
  })

  it('fails closed when identity reads fail', async () => {
    const { createVisitorSessionSyncEngine } = await import('../src/utils/visitor-session-sync')
    const query = vi.fn(async () => [
      [
        'uuid-1',
        '$pageview',
        'distinct-1',
        '2026-07-23T09:00:01.000Z',
        { $session_id: 'session-1' },
      ] as const,
    ])
    const repairAttribution = vi.fn(async () => ({
      candidate_orders: 0,
      repaired_orders: 0,
      remaining_unattributed_orders: 0,
    }))
    const run = createVisitorSessionSyncEngine({
      query,
      repairAttribution,
      nowMs: () => Date.parse('2026-07-23T10:00:00.000Z'),
    })
    const db = {
      async raw<T = Record<string, unknown>>(sql: string): Promise<T[]> {
        if (sql.includes('SELECT MAX(last_event_at)')) {
          return [{ max_ts: '2026-07-23T09:15:00.000Z' }] as T[]
        }
        if (sql.includes('FROM visitor_sessions') && sql.includes('WHERE distinct_id')) return []
        if (sql.includes('FROM contacts')) throw new Error('database unavailable')
        throw new Error(`Unexpected SQL in fail-closed test: ${sql}`)
      },
    }

    await expect(
      run({
        db,
        privateKey: 'posthog-private',
        log: console,
      }),
    ).rejects.toThrow('database unavailable')
    expect(repairAttribution).not.toHaveBeenCalled()
  })

  it('does not repeat session counters when an overlap replays an event UUID', async () => {
    const { createVisitorSessionSyncEngine } = await import('../src/utils/visitor-session-sync')
    const event = [
      'uuid-1',
      '$pageview',
      'distinct-1',
      '2026-07-23T09:00:01.000Z',
      { $session_id: 'session-1' },
    ] as const
    const query = vi.fn(async () => [event])
    const db = createRuntimeDb()
    const run = createVisitorSessionSyncEngine({
      query,
      repairAttribution: vi.fn(async () => ({
        candidate_orders: 0,
        repaired_orders: 0,
        remaining_unattributed_orders: 0,
      })),
      nowMs: () => Date.parse('2026-07-23T10:00:00.000Z'),
    })

    await run({ db, privateKey: 'posthog-private', log: console })
    await run({ db, privateKey: 'posthog-private', log: console })

    expect(db.upserts).toHaveLength(2)
    expect(db.upserts.map((row) => row.pageviewsCount)).toEqual([1, 1])
    expect(db.upserts.map((row) => row.seenEventUuids)).toEqual([['uuid-1'], ['uuid-1']])
  })

  it('stops mid-page on cancellation and before the next event on the time bound', async () => {
    const { createVisitorSessionSyncEngine } = await import('../src/utils/visitor-session-sync')
    const rows = [
      ['uuid-1', '$pageview', 'distinct-1', '2026-07-23T09:00:01.000Z', { $session_id: 'session-1' }],
      ['uuid-2', '$pageview', 'distinct-2', '2026-07-23T09:00:02.000Z', { $session_id: 'session-2' }],
    ] as const
    const controller = new AbortController()
    const cancelledDb = createRuntimeDb(() => controller.abort())
    const repairAttribution = vi.fn(async () => ({
      candidate_orders: 0,
      repaired_orders: 0,
      remaining_unattributed_orders: 0,
    }))
    const cancelledRun = createVisitorSessionSyncEngine({
      query: vi.fn(async () => [...rows]),
      repairAttribution,
      nowMs: () => 0,
    })

    await cancelledRun({
      db: cancelledDb,
      privateKey: 'posthog-private',
      signal: controller.signal,
      log: console,
    })

    expect(cancelledDb.upserts).toHaveLength(1)
    expect(repairAttribution).not.toHaveBeenCalled()

    let clockReads = 0
    const boundedDb = createRuntimeDb()
    const boundedRun = createVisitorSessionSyncEngine({
      query: vi.fn(async () => [...rows]),
      repairAttribution: vi.fn(async () => ({
        candidate_orders: 0,
        repaired_orders: 0,
        remaining_unattributed_orders: 0,
      })),
      nowMs: () => {
        clockReads += 1
        return clockReads >= 4 ? 100 : 0
      },
    })

    await boundedRun({
      db: boundedDb,
      privateKey: 'posthog-private',
      maxRunMs: 50,
      log: console,
    })

    expect(boundedDb.upserts).toHaveLength(1)
  })

  it('accounts for attribution repair failure without losing projected sessions', async () => {
    const { createVisitorSessionSyncEngine } = await import('../src/utils/visitor-session-sync')
    const warn = vi.fn()
    const run = createVisitorSessionSyncEngine({
      query: vi.fn(async () => []),
      repairAttribution: vi.fn(async () => {
        throw new Error('repair unavailable')
      }),
      nowMs: () => Date.parse('2026-07-23T10:00:00.000Z'),
    })

    const result = await run({
      db: createRuntimeDb(),
      privateKey: 'posthog-private',
      log: { info: vi.fn(), warn },
    })

    expect(result.errors).toBe(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('repair unavailable'))
  })
})

function createRuntimeDb(onInsert?: () => void) {
  const upserts: Array<{
    emailAtSessionStart: string | null
    pageviewsCount: number
    seenEventUuids: string[] | null
  }> = []
  const sessions = new Map<string, Record<string, unknown>>()
  let maxTimestampReads = 0
  return {
    upserts,
    get maxTimestampReads() {
      return maxTimestampReads
    },
    async raw<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
      if (query.includes('SELECT MAX(last_event_at)')) {
        maxTimestampReads += 1
        return [{ max_ts: '2026-07-23T09:15:00.000Z' }] as T[]
      }
      if (query.includes('FROM visitor_sessions') && query.includes('WHERE distinct_id')) {
        const existing = sessions.get(`${params[0]}|${params[1]}`)
        return (existing ? [existing] : []) as T[]
      }
      if (query.includes('FROM contacts')) return []
      if (query.includes('FROM orders')) return []
      if (query.includes('INSERT INTO visitor_sessions')) {
        const seenEventUuids = params[25] ? (JSON.parse(params[25] as string) as string[]) : null
        upserts.push({
          emailAtSessionStart: (params[5] as string | null) ?? null,
          pageviewsCount: params[4] as number,
          seenEventUuids,
        })
        sessions.set(`${params[0]}|${params[1]}`, {
          id: 'session-row',
          started_at: params[2],
          last_event_at: params[3],
          pageviews_count: params[4],
          email_at_session_start: params[5],
          email_at_session_end: params[6],
          contact_id: params[7],
          segment_at_session_start: params[8],
          first_url: params[9],
          utm_source: params[10],
          utm_medium: params[11],
          utm_campaign: params[12],
          referring_domain: params[13],
          is_paid_session: params[14],
          carts_viewed_in_session: params[15],
          carts_created_in_session: params[16],
          carts_updated_in_session: params[17],
          cart_converted: params[18],
          order_id: params[19],
          became_customer_in_session: params[20],
          became_customer_at: params[21],
          email_acquired_in_session: params[22],
          email_acquired_via: params[23],
          email_acquired_at: params[24],
          seen_event_uuids: seenEventUuids,
        })
        onInsert?.()
        return []
      }
      throw new Error(`Unexpected SQL in visitor-session sync test: ${query}`)
    },
  }
}
