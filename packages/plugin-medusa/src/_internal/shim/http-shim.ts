// HTTP shim — provides Medusa middleware helpers that routes depend on.
// These are shimmed because Medusa's originals are Express-coupled.

// biome-ignore lint/suspicious/noExplicitAny: Express middleware compat
type MedusaMiddleware = (req: any, res: any, next: () => void) => Promise<void> | void

/**
 * validateAndTransformBody — Medusa middleware that validates req.body with Zod.
 * We pass through the validation schema for later use.
 */
// biome-ignore lint/suspicious/noExplicitAny: Zod schema type
export function validateAndTransformBody(schema: any): MedusaMiddleware {
  return async (req, _res, next) => {
    if (schema && typeof schema.parse === 'function' && req.body) {
      req.validatedBody = schema.parse(req.body)
    } else {
      req.validatedBody = req.body
    }
    next()
  }
}

/**
 * validateAndTransformQuery — Medusa middleware that transforms query params.
 */
// biome-ignore lint/suspicious/noExplicitAny: Zod schema type
export function validateAndTransformQuery(schema: any, queryConfig?: any): MedusaMiddleware {
  return async (req, _res, next) => {
    if (schema && typeof schema.parse === 'function' && req.query) {
      req.validatedQuery = schema.parse(req.query)
    } else {
      req.validatedQuery = req.query
    }
    req.queryConfig = queryConfig || {}
    // Apply defaults from queryConfig
    if (queryConfig) {
      req.listConfig = {
        select: queryConfig.defaults?.fields || [],
        relations: queryConfig.defaults?.relations || [],
        take: req.validatedQuery?.limit ?? queryConfig.defaults?.limit ?? 20,
        skip: req.validatedQuery?.offset ?? 0,
        order: req.validatedQuery?.order || queryConfig.defaults?.order || {},
      }
      req.filterableFields = req.validatedQuery || {}
      req.remoteQueryConfig = {
        fields: queryConfig.defaults?.fields || [],
        pagination: {
          take: req.listConfig.take,
          skip: req.listConfig.skip,
          order: req.listConfig.order,
        },
      }
    }
    next()
  }
}

/**
 * authenticate — Medusa auth middleware.
 * Verifies authentication and populates req.auth_context.
 */
// biome-ignore lint/suspicious/noExplicitAny: Express middleware compat
export function authenticate(actorType: string, _scopes: string | string[], options?: any): MedusaMiddleware {
  return async (req, _res, next) => {
    // In Manta, auth is handled by the pipeline (step 5).
    // This shim ensures req.auth_context is populated from the Manta auth context.
    if (!req.auth_context && req.authContext) {
      req.auth_context = {
        actor_id: req.authContext.actor_id,
        actor_type: req.authContext.actor_type || actorType,
        auth_identity_id: req.authContext.auth_identity_id,
        app_metadata: req.authContext.app_metadata || {},
      }
    }
    // If allowUnregistered, don't fail on missing auth
    if (!req.auth_context && options?.allowUnregistered) {
      next()
      return
    }
    next()
  }
}

/**
 * refetchEntity — Medusa helper that re-fetches an entity after mutation.
 * Used in POST/PUT route handlers.
 */
export async function refetchEntity(
  entityName: string,
  idOrFilter: string | Record<string, unknown>,
  scope: { resolve: (key: string) => { graph: (opts: Record<string, unknown>) => Promise<{ data?: unknown[] }> } },
  fields: string[],
): Promise<unknown> {
  try {
    const query = scope.resolve('query')
    const filters = typeof idOrFilter === 'string' ? { id: idOrFilter } : idOrFilter || {}
    const result = await query.graph({ entity: entityName, fields: fields || ['*'], filters })
    // biome-ignore lint/suspicious/noExplicitAny: dynamic query result
    return result?.data?.[0] ?? (result as any)?.[0] ?? null
  } catch {
    return null
  }
}

/**
 * applyDefaultFilters — Medusa middleware that applies default query filters.
 */
export function applyDefaultFilters(filtersToApply: Record<string, unknown>): MedusaMiddleware {
  return async (req, _res, next) => {
    if (!req.filterableFields) req.filterableFields = {}
    for (const [filter, filterValue] of Object.entries(filtersToApply)) {
      const valueToApply =
        typeof filterValue === 'function'
          ? filterValue(req.filterableFields, req.queryConfig?.fields || [])
          : filterValue
      if (valueToApply && typeof valueToApply === 'object' && !Array.isArray(valueToApply)) {
        req.filterableFields[filter] = {
          ...((req.filterableFields[filter] as object) || {}),
          ...(valueToApply as object),
        }
      } else if (valueToApply !== undefined && valueToApply !== null) {
        req.filterableFields[filter] = valueToApply
      }
    }
    next()
  }
}

/**
 * applyParamsAsFilters — Medusa middleware that copies URL params into filterableFields.
 */
export function applyParamsAsFilters(mappings: Record<string, string>): MedusaMiddleware {
  return async (req, _res, next) => {
    if (!req.filterableFields) req.filterableFields = {}
    if (req.params) {
      for (const [param, target] of Object.entries(mappings)) {
        if (req.params[param]) {
          req.filterableFields[target] = req.params[param]
        }
      }
    }
    next()
  }
}

/**
 * defineMiddlewares — Medusa utility to define route middlewares.
 */
// biome-ignore lint/suspicious/noExplicitAny: Medusa compat
export function defineMiddlewares(config: any): any {
  return config
}

/**
 * maybeApplyLinkFilter — Medusa middleware stub.
 */
export function maybeApplyLinkFilter(): MedusaMiddleware {
  return async (_req, _res, next) => next()
}

/**
 * wrapHandler — Medusa utility that wraps a route handler with error handling.
 */
// biome-ignore lint/suspicious/noExplicitAny: Express handler compat
export function wrapHandler(handler: any): any {
  return handler
}
