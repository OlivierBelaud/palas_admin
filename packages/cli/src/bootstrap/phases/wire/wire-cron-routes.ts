// Framework-owned HTTP catch-all for scheduled jobs.
//
// `defineJob(name, schedule, handler)` registers user jobs into the
// IJobSchedulerPort at boot. To trigger them on serverless platforms
// (Vercel Cron, Cloudflare Cron Triggers, etc.) we expose a single
// HTTP route that dispatches by job name:
//
//   GET|POST /api/crons/:name  →  scheduler.runJob(name)
//
// Auth: when `CRON_SECRET` is set, the request must carry
// `Authorization: Bearer <CRON_SECRET>`. Vercel Cron auto-injects this
// header on every cron invocation when the project has a CRON_SECRET
// env var configured. When the secret is absent we accept all callers
// and emit a single warn at boot — fine for `manta dev`, refused in
// `manta build --preset vercel` deployments where it should always be
// configured.
//
// The handler is framework-owned; user apps get this for free without
// touching `src/api/`. The route must NOT be context-scoped (no JWT
// admin auth) — it's meant to be called by the scheduler trigger, not
// a logged-in user.

import type { IJobSchedulerPort, JobResult } from '@manta/core'
import type { AppRef, BootstrapContext } from '../../bootstrap-context'

export async function wireCronRoutes(ctx: BootstrapContext, appRef: AppRef): Promise<void> {
  const { logger, adapter } = ctx

  function parseJobName(req: Request): string | null {
    const url = new URL(req.url, 'http://localhost')
    const segments = url.pathname.split('/').filter(Boolean)
    const idx = segments.indexOf('crons')
    if (idx < 0 || idx + 1 >= segments.length) return null
    const name = segments[idx + 1]
    return name && name.length > 0 ? decodeURIComponent(name) : null
  }

  function resolveScheduler(): IJobSchedulerPort | null {
    try {
      return appRef.current!.resolve<IJobSchedulerPort>('IJobSchedulerPort')
    } catch {
      return null
    }
  }

  /**
   * Validate the Bearer token against `CRON_SECRET`.
   * Returns `null` on success, or a Response (401) on failure.
   * When `CRON_SECRET` is unset we accept everything (dev mode); a
   * separate warn was logged at boot.
   */
  function checkAuth(req: Request): Response | null {
    const secret = process.env.CRON_SECRET
    if (!secret) return null // dev / unconfigured
    const authHeader = req.headers.get('authorization') ?? ''
    const expected = `Bearer ${secret}`
    if (authHeader !== expected) {
      return Response.json({ type: 'UNAUTHORIZED', message: 'invalid CRON_SECRET' }, { status: 401 })
    }
    return null
  }

  async function handle(req: Request): Promise<Response> {
    const authError = checkAuth(req)
    if (authError) return authError

    const name = parseJobName(req)
    if (!name) {
      return Response.json({ type: 'INVALID_DATA', message: 'job name is required in URL' }, { status: 400 })
    }

    const scheduler = resolveScheduler()
    if (!scheduler) {
      return Response.json({ type: 'NOT_IMPLEMENTED', message: 'IJobSchedulerPort is not configured' }, { status: 501 })
    }

    const startMs = Date.now()
    try {
      const result: JobResult = await scheduler.runJob(name)
      // Prefer wall-clock since the registered handler currently hard-codes
      // duration_ms:0 in load-resources (deferred WP-F15).
      const duration_ms = result.duration_ms || Date.now() - startMs
      const errMsg = result.error?.message
      const code = result.status === 'failure' ? 500 : 200
      const body: Record<string, unknown> = { status: result.status, duration_ms }
      if (errMsg) body.error = errMsg
      // Surface handler return value (sync result counts, etc.) so cron callers
      // can verify a no-op vs an actual sync without inspecting server logs.
      if ((result as { data?: unknown }).data !== undefined) {
        body.data = (result as { data?: unknown }).data
      }
      return Response.json(body, { status: code })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Unknown job name → 404, anything else → 500
      const isUnknown = message.startsWith('Job "') && message.includes('not registered')
      return Response.json(
        { type: isUnknown ? 'NOT_FOUND' : 'UNEXPECTED_STATE', message, duration_ms: Date.now() - startMs },
        { status: isUnknown ? 404 : 500 },
      )
    }
  }

  adapter.registerRoute('GET', '/api/crons/:name', handle)
  adapter.registerRoute('POST', '/api/crons/:name', handle)

  if (!process.env.CRON_SECRET) {
    logger.warn('[crons] CRON_SECRET is not set — /api/crons/:name accepts unauthenticated requests')
  }
  logger.info('[crons] Framework route: GET|POST /api/crons/:name (auth: Bearer CRON_SECRET)')
}
