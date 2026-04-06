// SPEC-004 — Module system: Module() factory and ModuleExports
// Signature aligned with Medusa V2: Module(serviceName, { service, loaders })

import type { MantaApp } from '../app'

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
  // biome-ignore lint/suspicious/noExplicitAny: module service class
  service: new (
    ...args: any[]
  ) => unknown
  loaders?: Array<(app: MantaApp) => Promise<void>>
  runMigrations?: () => Promise<void>
  revertMigration?: () => Promise<void>
  generateMigration?: () => Promise<string>
  discoveryPath?: string
  version?: string
  hooks?: ModuleLifecycleHooks
  models?: Record<string, unknown>
  linkableKeys?: Record<string, string>
  linkable?: Record<string, unknown>
}

/**
 * Module() factory — wraps a service class into a ModuleExports.
 * Signature aligned with Medusa V2: Module(serviceName, { service, loaders })
 *
 * Usage:
 *   export default Module("product", {
 *     service: ProductModuleService,
 *     loaders: [...]
 *   })
 */
export function Module(
  serviceName: string,
  config: {
    // biome-ignore lint/suspicious/noExplicitAny: module service class
    service: new (
      ...args: any[]
    ) => unknown
    loaders?: ModuleExports['loaders']
    hooks?: ModuleLifecycleHooks
    version?: string
    models?: Record<string, unknown>
  },
): ModuleExports {
  const linkableKeys: Record<string, string> = {}
  if (config.models) {
    for (const [key, model] of Object.entries(config.models)) {
      const entityName = (model as { name?: string }).name ?? key
      linkableKeys[`${entityName.toLowerCase()}_id`] = entityName
    }
  }

  // Auto-generate linkable config from models
  const linkable: Record<string, unknown> = {}
  if (config.models) {
    for (const [key, model] of Object.entries(config.models)) {
      const entityName = (model as { name?: string }).name ?? key
      linkable[`${entityName.toLowerCase()}_id`] = {
        serviceName,
        entity: entityName,
        primaryKey: 'id',
        field: `${entityName.toLowerCase()}_id`,
      }
    }
  }

  return {
    name: serviceName,
    service: config.service,
    loaders: config.loaders,
    hooks: config.hooks,
    version: config.version,
    models: config.models,
    linkableKeys: Object.keys(linkableKeys).length > 0 ? linkableKeys : undefined,
    linkable: Object.keys(linkable).length > 0 ? linkable : undefined,
  }
}

/**
 * defineModule() — alias for Module() with explicit config object.
 * Kept for backward compatibility.
 */
export function defineModule(config: {
  // biome-ignore lint/suspicious/noExplicitAny: module service class
  service: new (
    ...args: any[]
  ) => unknown
  name: string
  loaders?: ModuleExports['loaders']
  hooks?: ModuleLifecycleHooks
  version?: string
  models?: Record<string, unknown>
}): ModuleExports {
  return Module(config.name, config)
}
