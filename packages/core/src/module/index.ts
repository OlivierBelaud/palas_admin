// SPEC-004 — Module system: Module() factory and ModuleExports

import type { IContainer } from '../container'

/**
 * Module lifecycle hooks.
 */
export interface ModuleLifecycleHooks {
  onApplicationStart?: () => Promise<void> | void
  onApplicationShutdown?: () => Promise<void> | void
  onApplicationPrepareShutdown?: () => Promise<void> | void
}

/**
 * Module export contract — what each module must provide.
 */
export interface ModuleExports {
  name: string
  service: new (...args: unknown[]) => unknown
  loaders?: Array<(container: IContainer) => Promise<void>>
  runMigrations?: () => Promise<void>
  revertMigration?: () => Promise<void>
  generateMigration?: () => Promise<string>
  discoveryPath?: string
  version?: string
  hooks?: ModuleLifecycleHooks
  models?: Record<string, unknown>
  linkableKeys?: Record<string, string>
}

/**
 * Options for Module() factory.
 */
export interface ModuleOptions {
  name?: string
  loaders?: ModuleExports['loaders']
  hooks?: ModuleLifecycleHooks
  version?: string
}

/**
 * Module() factory — wraps a service class into a ModuleExports.
 * Auto-generates linkable keys from DML entities if models are provided.
 *
 * Usage:
 *   export default Module(ProductService, {
 *     name: 'product',
 *     hooks: { onApplicationStart: async () => { ... } }
 *   })
 */
export function Module(
  service: new (...args: unknown[]) => unknown,
  options?: ModuleOptions,
): ModuleExports {
  const name = options?.name ?? service.name.replace(/Service$/i, '').toLowerCase()

  return {
    name,
    service,
    loaders: options?.loaders,
    hooks: options?.hooks,
    version: options?.version,
  }
}

/**
 * defineModule() — alias for Module() with explicit config object.
 */
export function defineModule(config: {
  service: new (...args: unknown[]) => unknown
  name?: string
  loaders?: ModuleExports['loaders']
  hooks?: ModuleLifecycleHooks
  version?: string
  models?: Record<string, unknown>
}): ModuleExports {
  const name = config.name ?? config.service.name.replace(/Service$/i, '').toLowerCase()

  const linkableKeys: Record<string, string> = {}
  if (config.models) {
    for (const [key, model] of Object.entries(config.models)) {
      const entityName = (model as { name?: string }).name ?? key
      linkableKeys[`${entityName.toLowerCase()}_id`] = entityName
    }
  }

  return {
    name,
    service: config.service,
    loaders: config.loaders,
    hooks: config.hooks,
    version: config.version,
    models: config.models,
    linkableKeys: Object.keys(linkableKeys).length > 0 ? linkableKeys : undefined,
  }
}
