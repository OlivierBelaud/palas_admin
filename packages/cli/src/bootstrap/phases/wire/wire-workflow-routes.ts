// Framework-owned workflow introspection endpoints — WORKFLOW_PROGRESS.md §6.5.
//
// Mounted under the admin context basePath (/api/admin) so they inherit the
// same JWT/admin auth rule registered by user-routes.ts. Both endpoints are
// framework-owned and not context-scoped — they never dispatch into a
// user-defined command or query.
//
// GET    /api/admin/_workflow/:id   → merge durable (store) + live (progress
//                                     channel) and return a single snapshot.
// DELETE /api/admin/_workflow/:id   → request cancel (idempotent); publish
//                                     `workflow:cancel` on the event bus when
//                                     one is wired, so running WorkflowManager
//                                     subscriptions abort immediately.

import type { IEventBusPort, IProgressChannelPort, IWorkflowStorePort } from '@manta/core'
import type { AppRef, BootstrapContext } from '../../bootstrap-context'

export async function wireWorkflowRoutes(ctx: BootstrapContext, appRef: AppRef): Promise<void> {
  const { logger, adapter } = ctx

  function parseRunId(req: Request): string | null {
    const url = new URL(req.url, 'http://localhost')
    const segments = url.pathname.split('/').filter(Boolean)
    const idx = segments.indexOf('_workflow')
    if (idx < 0 || idx + 1 >= segments.length) return null
    const id = segments[idx + 1]
    return id && id.length > 0 ? id : null
  }

  function resolveStore(): IWorkflowStorePort | null {
    try {
      return appRef.current!.resolve<IWorkflowStorePort>('IWorkflowStorePort')
    } catch {
      return null
    }
  }

  function resolveProgressChannel(): IProgressChannelPort | null {
    try {
      return appRef.current!.resolve<IProgressChannelPort>('IProgressChannelPort')
    } catch {
      return null
    }
  }

  function resolveEventBus(): IEventBusPort | null {
    try {
      return appRef.current!.resolve<IEventBusPort>('IEventBusPort')
    } catch {
      return null
    }
  }

  function toIso(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'string') return value
    const maybe = value as { toISOString?: () => string }
    if (typeof maybe.toISOString === 'function') return maybe.toISOString()
    return undefined
  }

  adapter.registerRoute('GET', '/api/admin/_workflow/:id', async (req: Request) => {
    try {
      const runId = parseRunId(req)
      if (!runId) {
        return Response.json({ type: 'INVALID_DATA', message: 'runId is required in URL' }, { status: 400 })
      }

      const store = resolveStore()
      if (!store) {
        return Response.json(
          { type: 'NOT_IMPLEMENTED', message: 'IWorkflowStorePort is not configured' },
          { status: 501 },
        )
      }

      const progressChannel = resolveProgressChannel()
      const [run, live] = await Promise.all([
        store.get(runId),
        progressChannel ? progressChannel.get(runId).catch(() => null) : Promise.resolve(null),
      ])

      if (!run) {
        return Response.json({ type: 'NOT_FOUND', message: `workflow run "${runId}" not found` }, { status: 404 })
      }

      return Response.json({
        data: {
          id: run.id,
          command_name: run.command_name,
          status: run.status,
          steps: run.steps,
          inFlightProgress: live ?? undefined,
          output: run.output,
          error: run.error,
          started_at: toIso(run.started_at),
          completed_at: toIso(run.completed_at),
          cancel_requested_at: toIso(run.cancel_requested_at),
        },
      })
    } catch (err) {
      return Response.json({ type: 'UNEXPECTED_STATE', message: (err as Error).message }, { status: 500 })
    }
  })

  adapter.registerRoute('DELETE', '/api/admin/_workflow/:id', async (req: Request) => {
    try {
      const runId = parseRunId(req)
      if (!runId) {
        return Response.json({ type: 'INVALID_DATA', message: 'runId is required in URL' }, { status: 400 })
      }

      const store = resolveStore()
      if (!store) {
        return Response.json(
          { type: 'NOT_IMPLEMENTED', message: 'IWorkflowStorePort is not configured' },
          { status: 501 },
        )
      }

      const run = await store.get(runId)
      if (!run) {
        return Response.json({ type: 'NOT_FOUND', message: `workflow run "${runId}" not found` }, { status: 404 })
      }

      // requestCancel is idempotent — no-op on terminal runs, and a second
      // call while cancel-requested is safe.
      await store.requestCancel(runId)

      // Publish the cancel event if an eventbus is wired. Running
      // WorkflowManagers subscribed on run start will abort immediately
      // (see manager.ts). Without an eventbus, the step-boundary fallback
      // from PR-3 still catches the cancel on the next check.
      const eventBus = resolveEventBus()
      if (eventBus) {
        await eventBus
          .emit({
            eventName: 'workflow:cancel',
            data: { runId },
            metadata: { timestamp: Date.now() },
          })
          .catch((err) => {
            logger.warn(`[workflow-cancel] eventbus emit failed: ${(err as Error)?.message ?? err}`)
          })
      }

      return Response.json({ data: { status: 'cancel_requested', runId } })
    } catch (err) {
      return Response.json({ type: 'UNEXPECTED_STATE', message: (err as Error).message }, { status: 500 })
    }
  })

  logger.info('[workflow] Framework routes: GET|DELETE /api/admin/_workflow/:id')
}
