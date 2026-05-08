// CRON-HTTP — GET|POST /api/crons/:name framework-owned catch-all.
// Covers auth (Bearer CRON_SECRET), unknown job names, and dispatch into
// IJobSchedulerPort.runJob.

import { H3Adapter } from '@manta/adapter-h3'
import type { IJobSchedulerPort, JobExecution, JobResult, MantaApp } from '@manta/core'
import { MantaError } from '@manta/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppRef, BootstrapContext } from '../../../src/bootstrap/bootstrap-context'
import { wireCronRoutes } from '../../../src/bootstrap/phases/wire/wire-cron-routes'

class FakeScheduler implements IJobSchedulerPort {
  calls: string[] = []
  result: JobResult = { status: 'success', duration_ms: 12 }
  shouldThrow: 'unknown' | 'crash' | null = null

  register(): void {
    /* not exercised */
  }
  async runJob(name: string): Promise<JobResult> {
    this.calls.push(name)
    if (this.shouldThrow === 'unknown') {
      throw new MantaError('NOT_FOUND', `Job "${name}" not registered`)
    }
    if (this.shouldThrow === 'crash') {
      throw new Error('boom')
    }
    return this.result
  }
  async getJobHistory(): Promise<JobExecution[]> {
    return []
  }
}

interface Harness {
  adapter: H3Adapter
  scheduler: FakeScheduler
}

async function buildHarness(): Promise<Harness> {
  const adapter = new H3Adapter({ port: 0, isDev: true })
  const scheduler = new FakeScheduler()

  const resolveMap = new Map<string, unknown>()
  resolveMap.set('IJobSchedulerPort', scheduler)
  const app = {
    resolve<T>(key: string): T {
      const v = resolveMap.get(key)
      if (v === undefined) throw new Error(`Cannot resolve "${key}"`)
      return v as T
    },
  } as unknown as MantaApp

  const appRef: AppRef = { current: app }

  const fakeLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => fakeLogger,
  }

  const ctx = {
    adapter,
    logger: fakeLogger,
  } as unknown as BootstrapContext

  await wireCronRoutes(ctx, appRef)
  return { adapter, scheduler }
}

describe('GET|POST /api/crons/:name', () => {
  let harness: Harness
  let originalSecret: string | undefined

  beforeEach(async () => {
    originalSecret = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    harness = await buildHarness()
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  // CRON-HTTP-01 — happy path GET dispatches to scheduler
  it('CRON-HTTP-01 — GET /api/crons/<name> dispatches to scheduler.runJob and returns 200', async () => {
    const res = await harness.adapter.handleRequest(
      new Request('http://test/api/crons/sync-posthog-events', { method: 'GET' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; duration_ms: number }
    expect(body.status).toBe('success')
    expect(typeof body.duration_ms).toBe('number')
    expect(harness.scheduler.calls).toEqual(['sync-posthog-events'])
  })

  // CRON-HTTP-02 — POST also works (Vercel triggers via either)
  it('CRON-HTTP-02 — POST also dispatches', async () => {
    const res = await harness.adapter.handleRequest(
      new Request('http://test/api/crons/detect-abandoned-carts', { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    expect(harness.scheduler.calls).toEqual(['detect-abandoned-carts'])
  })

  // CRON-HTTP-03 — kebab-case names with multiple hyphens
  it('CRON-HTTP-03 — kebab-case names with hyphens are passed through verbatim', async () => {
    const res = await harness.adapter.handleRequest(
      new Request('http://test/api/crons/sync-from-shopify', { method: 'GET' }),
    )
    expect(res.status).toBe(200)
    expect(harness.scheduler.calls).toEqual(['sync-from-shopify'])
  })

  // CRON-HTTP-04 — unknown job → 404
  it('CRON-HTTP-04 — unknown job name returns 404', async () => {
    harness.scheduler.shouldThrow = 'unknown'
    const res = await harness.adapter.handleRequest(new Request('http://test/api/crons/no-such-job', { method: 'GET' }))
    expect(res.status).toBe(404)
    const body = (await res.json()) as { type: string; message: string }
    expect(body.type).toBe('NOT_FOUND')
    expect(body.message).toContain('no-such-job')
  })

  // CRON-HTTP-05 — runJob crash → 500
  it('CRON-HTTP-05 — handler crash returns 500 with message', async () => {
    harness.scheduler.shouldThrow = 'crash'
    const res = await harness.adapter.handleRequest(
      new Request('http://test/api/crons/sync-posthog-events', { method: 'GET' }),
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { type: string; message: string }
    expect(body.type).toBe('UNEXPECTED_STATE')
    expect(body.message).toBe('boom')
  })

  // CRON-HTTP-06 — failure result from runJob → 500 with error message
  it('CRON-HTTP-06 — JobResult.status=failure returns 500 with error message', async () => {
    harness.scheduler.result = {
      status: 'failure',
      error: new MantaError('UNEXPECTED_STATE', 'kaboom'),
      duration_ms: 5,
    }
    const res = await harness.adapter.handleRequest(
      new Request('http://test/api/crons/sync-posthog-events', { method: 'GET' }),
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { status: string; error: string; duration_ms: number }
    expect(body.status).toBe('failure')
    expect(body.error).toBe('kaboom')
  })
})

describe('GET|POST /api/crons/:name — auth (CRON_SECRET)', () => {
  let originalSecret: string | undefined

  beforeEach(() => {
    originalSecret = process.env.CRON_SECRET
  })
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  // CRON-HTTP-07 — secret set + correct Bearer → 200
  it('CRON-HTTP-07 — Bearer matches CRON_SECRET → 200', async () => {
    process.env.CRON_SECRET = 's3cret'
    const harness = await buildHarness()
    const res = await harness.adapter.handleRequest(
      new Request('http://test/api/crons/sync-posthog-events', {
        method: 'GET',
        headers: { authorization: 'Bearer s3cret' },
      }),
    )
    expect(res.status).toBe(200)
    expect(harness.scheduler.calls).toEqual(['sync-posthog-events'])
  })

  // CRON-HTTP-08 — wrong Bearer → 401, scheduler NOT invoked
  it('CRON-HTTP-08 — Bearer does not match → 401 and scheduler is not invoked', async () => {
    process.env.CRON_SECRET = 's3cret'
    const harness = await buildHarness()
    const res = await harness.adapter.handleRequest(
      new Request('http://test/api/crons/sync-posthog-events', {
        method: 'GET',
        headers: { authorization: 'Bearer wrong' },
      }),
    )
    expect(res.status).toBe(401)
    expect(harness.scheduler.calls).toEqual([])
  })

  // CRON-HTTP-09 — missing header when secret set → 401
  it('CRON-HTTP-09 — missing Authorization header when CRON_SECRET is set → 401', async () => {
    process.env.CRON_SECRET = 's3cret'
    const harness = await buildHarness()
    const res = await harness.adapter.handleRequest(
      new Request('http://test/api/crons/sync-posthog-events', { method: 'GET' }),
    )
    expect(res.status).toBe(401)
    expect(harness.scheduler.calls).toEqual([])
  })

  // CRON-HTTP-10 — no CRON_SECRET in env → all callers accepted (dev mode)
  it('CRON-HTTP-10 — when CRON_SECRET is unset, missing header is accepted (dev mode)', async () => {
    delete process.env.CRON_SECRET
    const harness = await buildHarness()
    const res = await harness.adapter.handleRequest(
      new Request('http://test/api/crons/sync-posthog-events', { method: 'GET' }),
    )
    expect(res.status).toBe(200)
  })
})
