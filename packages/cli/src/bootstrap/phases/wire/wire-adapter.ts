// Phase 5b: H3 adapter creation + auth verifier wiring.
// Also exports the shared `handleQueryRequest` helper used by context-aware CQRS endpoints.

import { H3Adapter, type ReadinessProbe } from '@manta/adapter-h3'
import type { ICachePort, IDatabasePort, IEventBusPort } from '@manta/core/ports'
import type { AppRef, BootstrapContext } from '../../bootstrap-context'

// ── Query handler helper ─────────────────────────────────────────────
// Shared logic for POST {basePath}/query/:entity endpoints.

interface QueryHandlerOptions {
  contextName: string
  exposedModules: Set<string>
  logger?: { warn: (msg: string) => void }
}

export async function handleQueryRequest(
  service: Record<string, unknown>,
  entity: string,
  body: Record<string, unknown>,
  options?: QueryHandlerOptions,
): Promise<Response> {
  const { id, fields, filters, limit, offset, order, q } = body as {
    id?: string
    fields?: string[]
    filters?: Record<string, unknown>
    limit?: number
    offset?: number
    order?: string
    q?: string
  }

  // Strip relation fields pointing to unmounted modules + collect warnings
  const warnings: string[] = []
  let filteredFields = fields
  if (fields && options?.exposedModules) {
    const allowed: string[] = []
    for (const f of fields) {
      if (f.includes('.')) {
        const relationModule = f.split('.')[0]
        if (!options.exposedModules.has(relationModule)) {
          warnings.push(
            `relation '${relationModule}' unavailable in context '${options.contextName}' — module '${relationModule}' not mounted`,
          )
          options.logger?.warn(
            `[query] Stripped relation '${relationModule}' from ${entity} query — not mounted in context '${options.contextName}'`,
          )
          continue
        }
      }
      allowed.push(f)
    }
    filteredFields = allowed
  }

  // Detail query
  if (id) {
    if (typeof service.findById !== 'function') {
      return Response.json(
        { type: 'NOT_FOUND', message: `Entity "${entity}" does not support findById` },
        { status: 404 },
      )
    }
    const item = await service.findById(id)
    if (!item) return Response.json({ type: 'NOT_FOUND', message: `${entity} "${id}" not found` }, { status: 404 })
    const response: Record<string, unknown> = { data: item }
    if (warnings.length > 0) response.warnings = warnings
    return Response.json(response)
  }

  // List query
  if (typeof service.list !== 'function') {
    return Response.json({ type: 'NOT_FOUND', message: `Entity "${entity}" does not support list` }, { status: 404 })
  }
  let data: Record<string, unknown>[] = (await (service.list as () => Promise<unknown[]>)()) as Record<
    string,
    unknown
  >[]

  // Search
  if (q) {
    const lower = (q as string).toLowerCase()
    data = data.filter(
      (item) =>
        String(item.title ?? '')
          .toLowerCase()
          .includes(lower) ||
        String(item.description ?? '')
          .toLowerCase()
          .includes(lower) ||
        String(item.sku ?? '')
          .toLowerCase()
          .includes(lower),
    )
  }

  // Filters
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (Array.isArray(value)) {
        data = data.filter((item) => value.includes(String(item[key])))
      } else {
        data = data.filter((item) => String(item[key]) === String(value))
      }
    }
  }

  // Ordering
  if (order) {
    let field: string
    let descending: boolean
    if ((order as string).startsWith('-')) {
      field = (order as string).slice(1)
      descending = true
    } else if ((order as string).includes(':')) {
      const [f, d] = (order as string).split(':')
      field = f
      descending = d === 'desc'
    } else {
      field = order as string
      descending = false
    }
    data.sort((a, b) => {
      const rawA = a[field] ?? ''
      const rawB = b[field] ?? ''
      if (typeof rawA === 'number' && typeof rawB === 'number') return descending ? rawB - rawA : rawA - rawB
      if (field.endsWith('_at')) {
        const ta = new Date(rawA as string | number | Date).getTime()
        const tb = new Date(rawB as string | number | Date).getTime()
        return descending ? tb - ta : ta - tb
      }
      const sa = String(rawA).toLowerCase()
      const sb = String(rawB).toLowerCase()
      return descending ? sb.localeCompare(sa) : sa.localeCompare(sb)
    })
  }

  // Paginate + field selection
  const count = data.length
  const sliced = data.slice(offset ?? 0, (offset ?? 0) + (limit ?? 100))
  let result = sliced
  if (filteredFields && filteredFields.length > 0) {
    result = sliced.map((item) => {
      const picked: Record<string, unknown> = {}
      for (const f of filteredFields) picked[f] = item[f]
      return picked
    })
  }

  const response: Record<string, unknown> = { data: result, count, limit: limit ?? 100, offset: offset ?? 0 }
  if (warnings.length > 0) response.warnings = warnings
  return Response.json(response)
}

export async function wireAdapter(ctx: BootstrapContext, _appRef: AppRef): Promise<void> {
  const { logger, mode, jwtSecret, authService, infraMap } = ctx

  // [13] Create H3 adapter and register CQRS endpoints
  // BC-F22 — Build readiness probes from the ports actually registered in
  // infraMap. Absent ports are simply omitted (so e.g. a dev project without
  // an external cache reports only {db, eventbus}). The database port exposes
  // healthCheck() directly; cache / eventbus ports expose an optional ping().
  const readinessProbes: Record<string, ReadinessProbe> = {}

  const db = infraMap.get('IDatabasePort') as IDatabasePort | undefined
  if (db) {
    readinessProbes.db = () => db.healthCheck()
  }

  const cache = infraMap.get('ICachePort') as ICachePort | undefined
  if (cache && typeof cache.ping === 'function') {
    readinessProbes.cache = () => (cache.ping as () => Promise<boolean>)()
  }

  const eventBus = infraMap.get('IEventBusPort') as IEventBusPort | undefined
  if (eventBus && typeof eventBus.ping === 'function') {
    readinessProbes.eventbus = () => (eventBus.ping as () => Promise<boolean>)()
  }

  const adapter = new H3Adapter({ port: 0, isDev: mode === 'dev', readinessProbes })
  ctx.adapter = adapter

  // Wire auth verifier
  adapter.setAuthVerifier(async (token: string) => {
    try {
      const payload = await authService.verifyToken(token, jwtSecret)
      const meta =
        (payload.metadata as Record<string, unknown>) ?? (payload.app_metadata as Record<string, unknown>) ?? {}
      return {
        id: (payload.id ?? payload.actor_id) as string,
        type: (payload.type ?? payload.actor_type) as string,
        auth_identity_id: payload.auth_identity_id as string,
        email: (meta.email as string) ?? undefined,
        metadata: meta,
      }
    } catch (err) {
      logger.warn(`[auth] Token verification failed: ${(err as Error).message}`)
      return null
    }
  })
}
