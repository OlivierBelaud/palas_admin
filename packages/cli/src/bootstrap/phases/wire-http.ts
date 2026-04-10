// Phase 5: Wire HTTP endpoints — auth, H3 adapter, contexts, routes, AI, dashboard, OpenAPI.
// Thin orchestrator — actual logic lives in ./wire/*.ts sub-phases.

import type { AppRef, BootstrapContext } from '../bootstrap-context'
import { wireAdapter, wireAuth, wireContexts, wireExtras } from './wire'

export async function wireHttpEndpoints(ctx: BootstrapContext, appRef: AppRef): Promise<void> {
  await wireAuth(ctx, appRef)
  await wireAdapter(ctx, appRef)
  await wireContexts(ctx, appRef)
  await wireExtras(ctx, appRef)
}
