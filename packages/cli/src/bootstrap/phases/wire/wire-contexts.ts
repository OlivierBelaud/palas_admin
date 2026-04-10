// Phase 5c: Contexts, user routes, context-aware CQRS, SPA warnings.
// Covers [13b-v2] SPA warnings, [13c] user routes, [13d] context registry,
// [13e] context-aware CQRS, [13f] V2 query endpoints, [13g] query graph endpoints.

import type { AppRef, BootstrapContext } from '../../bootstrap-context'
import { buildContextRegistry, cqrsRoutes, queryEndpoints, spaWarnings, userRoutes } from './contexts'

export async function wireContexts(ctx: BootstrapContext, appRef: AppRef): Promise<void> {
  await spaWarnings(ctx, appRef)
  await userRoutes(ctx, appRef)
  // Build the context registry explicitly, then thread it onto ctx for downstream sub-phases.
  // Downstream phases still read ctx.contextRegistry for backward compatibility within the pipeline.
  ctx.contextRegistry = await buildContextRegistry(ctx, appRef)
  await cqrsRoutes(ctx, appRef)
  await queryEndpoints(ctx, appRef)
  ctx.logger.info('[cqrs] Context-aware endpoints registered')
}
