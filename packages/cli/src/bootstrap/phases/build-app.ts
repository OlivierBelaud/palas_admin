// Phase 4: Build the final immutable MantaApp and wire extension context.

import type { AppRef, BootstrapContext } from '../bootstrap-context'

export async function buildApp(ctx: BootstrapContext, appRef: AppRef): Promise<void> {
  const { builder, logger } = ctx

  // Build the final immutable app
  appRef.current = builder.build()

  // Wire the extension context on the QueryService (so extension resolvers can access `app`).
  try {
    const qs = appRef.current!.resolve<import('@manta/core').QueryService>('queryService')
    qs.setExtensionContext(appRef.current!, logger)
  } catch {
    /* no queryService or no extensions */
  }
}
