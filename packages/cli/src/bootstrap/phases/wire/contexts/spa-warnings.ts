// [13b-v2] SPA warnings.

import type { AppRef, BootstrapContext } from '../../../bootstrap-context'

export async function spaWarnings(ctx: BootstrapContext, _appRef: AppRef): Promise<void> {
  const { logger, resources, userDefinitions } = ctx

  // [13b-v2] SPA warnings
  if (resources.spas.length > 0) {
    const userContexts = new Set(userDefinitions.map((u: any) => u.contextName))
    for (const spa of resources.spas) {
      if (!userContexts.has(spa.name) && spa.name !== 'public') {
        logger.warn(`SPA "${spa.name}" has no defineUserModel('${spa.name}') — no one can login to /${spa.name}`)
      } else {
        logger.info(`  SPA: /${spa.name} (from src/spa/${spa.name}/)`)
      }
    }
  }
}
