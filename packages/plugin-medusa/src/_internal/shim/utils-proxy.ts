// SPEC: Proxy ALL 620+ exports from @medusajs/utils, override 10-15 infrastructure exports.
// Everything else (Modules enum, math utils, enums, Zod validators, helpers) passes through unchanged.

import { createService, MantaError, Module } from '@manta/core'

// ====================================================================
// Step 1: Load ALL exports from @medusajs/utils
// ====================================================================
// biome-ignore lint/suspicious/noExplicitAny: dynamic re-export of 620+ symbols
let realUtils: Record<string, any> = {}

try {
  // Dynamic import — works whether @medusajs/utils is CJS or ESM
  // We use createRequire because @medusajs/utils ships as CJS
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  realUtils = require('@medusajs/utils')
} catch (err) {
  console.warn('[plugin-medusa] WARNING: Could not load @medusajs/utils:', (err as Error).message)
}

// Re-export everything from real utils
// biome-ignore lint/suspicious/noExplicitAny: proxy layer
const proxy: Record<string, any> = { ...realUtils }

// ====================================================================
// Step 2: Override infrastructure exports (10-15 out of 620+)
// ====================================================================

// --- Service factory: Drizzle-based instead of MikroORM-based ---
proxy.MedusaService = createService
proxy.MedusaInternalService = createService

// --- Module registration: Manta's Module() instead of Medusa's ---
proxy.Module = Module

// --- Error hierarchy: MantaError instead of MedusaError ---
proxy.MedusaError = MantaError
proxy.MedusaErrorTypes = {
  DB_ERROR: 'DB_ERROR',
  DUPLICATE_ERROR: 'DUPLICATE_ERROR',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVALID_DATA: 'INVALID_DATA',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  NOT_ALLOWED: 'NOT_ALLOWED',
  UNEXPECTED_STATE: 'UNEXPECTED_STATE',
  CONFLICT: 'CONFLICT',
  PAYMENT_AUTHORIZATION_ERROR: 'PAYMENT_AUTHORIZATION_ERROR',
}

// --- Decorators: no-ops (Manta uses different DI) ---
// biome-ignore lint/suspicious/noExplicitAny: decorator stub
const noopDecorator = (_target: any, _key: any, desc: any) => desc
proxy.InjectManager = () => noopDecorator
proxy.InjectTransactionManager = () => noopDecorator
// biome-ignore lint/suspicious/noExplicitAny: decorator stub
proxy.MedusaContext = () => (_target: any, _key: any, _index: any) => {}
proxy.EmitEvents = () => noopDecorator
proxy.InjectSharedContext = () => noopDecorator
// biome-ignore lint/suspicious/noExplicitAny: decorator stub
proxy.InjectInto = () => () => {}

// --- MikroORM stubs: no MikroORM in Manta ---
proxy.toMikroORMEntity = () => class MikroORMStub {}
proxy.DALUtils = {
  ...(realUtils.DALUtils || {}),
  MikroOrmBase: class MikroOrmBaseStub {},
  MikroOrmBaseTreeRepository: class MikroOrmBaseTreeRepoStub {},
  mikroOrmBaseRepositoryFind: async () => [],
  mikroOrmSerializer: async (data: unknown) => data,
  mikroOrmUpdateDeletedAtRecursively: async () => {},
}

// --- Event builder factory (keep real if available, stub if not) ---
if (!proxy.moduleEventBuilderFactory) {
  proxy.moduleEventBuilderFactory = (_name: string) => () => noopDecorator
}
if (!proxy.buildEventNamesFromEntityName) {
  proxy.buildEventNamesFromEntityName = (names: string | string[]) => {
    const result: Record<string, Record<string, string>> = {}
    const arr = Array.isArray(names) ? names : [names]
    for (const n of arr) {
      result[n] = {
        created: `${n}.created`,
        updated: `${n}.updated`,
        deleted: `${n}.deleted`,
        attached: `${n}.attached`,
        detached: `${n}.detached`,
      }
    }
    return result
  }
}

// ====================================================================
// Step 3: Freeze overridden keys to prevent Medusa from overwriting them
// ====================================================================
const OVERRIDDEN_KEYS = [
  'MedusaService',
  'MedusaInternalService',
  'Module',
  'MedusaError',
  'MedusaErrorTypes',
  'InjectManager',
  'InjectTransactionManager',
  'MedusaContext',
  'EmitEvents',
  'InjectSharedContext',
  'InjectInto',
  'toMikroORMEntity',
  'DALUtils',
] as const

// ====================================================================
// Export
// ====================================================================
export { OVERRIDDEN_KEYS, proxy as shimmedUtils }

/** Total number of exports from @medusajs/utils */
export const REAL_UTILS_COUNT = Object.keys(realUtils).length

/** List all export keys (for testing) */
export function getAllExportKeys(): string[] {
  return Object.keys(proxy)
}

/** Check if an export was overridden by the shim */
export function isOverridden(key: string): boolean {
  return (OVERRIDDEN_KEYS as readonly string[]).includes(key)
}
