// Phase 3: Assemble modules — thin orchestrator.
// Delegates to sub-phases in order: load modules → load links → load resources → wire commands.

import type { AppRef, BootstrapContext } from '../bootstrap-context'
import { loadLinks, loadModules, loadResources, wireCommands } from './assemble'

export async function assembleModules(ctx: BootstrapContext, appRef: AppRef): Promise<void> {
  // [7] DML entity discovery, table generation, service instantiation.
  await loadModules(ctx, appRef)

  // [7a-7g] Links, pivot tables, entity/link command generation.
  await loadLinks(ctx, appRef)

  // [8-12d] Workflows, subscribers, jobs, agents, commands, queries, user definitions.
  await loadResources(ctx, appRef)

  // [11b-12e] Command callables, relational query, QueryService.
  await wireCommands(ctx, appRef)
}
