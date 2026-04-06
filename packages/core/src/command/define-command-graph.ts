// defineCommandGraph — Expose module commands for a context via catch-all route.
//
// Three modes:
//   defineCommandGraph('*')                              → wildcard, all module commands
//   defineCommandGraph({ catalog: true, customer: ['create', 'update'] })
//                                                        → per-module filtering
//   No defineCommandGraph = no catch-all command access   → only explicit defineCommand routes
//
// Usage:
//   // src/commands/admin/graph.ts — full access
//   export default defineCommandGraph('*')
//
//   // src/commands/store/graph.ts — scoped access
//   export default defineCommandGraph({
//     catalog: true,
//     customer: ['create', 'update'],
//     order: (auth) => ({ customer_id: auth.id }),
//   })

import type { AuthContext } from '../auth/types'
import { MantaError } from '../errors/manta-error'

/**
 * Module name for command graph access — autocompletes from codegen.
 */
type ModuleNameArg = keyof MantaGeneratedAppModules | (string & {})

/**
 * Per-module command access rule:
 * - `true` — all commands of this module
 * - `string[]` — only these command operations (e.g. ['create', 'update', 'delete'])
 * - `(auth) => filters` — all commands, but with row-level scope injected into context
 */
export type CommandAccessRule = true | string[] | ((auth: AuthContext) => Record<string, unknown>)

/**
 * Module access map — defines which modules' commands are accessible and how.
 */
export type CommandAccessMap = Record<string, CommandAccessRule>

/**
 * Command graph definition — controls which module commands are exposed in a context.
 */
export interface CommandGraphDefinition {
  __type: 'command-graph'
  /** '*' = wildcard (all modules, all commands). Otherwise per-module rules. */
  access: '*' | CommandAccessMap
}

/**
 * Define command graph access for a context.
 *
 * @example
 * ```typescript
 * // src/commands/admin/graph.ts — full access
 * export default defineCommandGraph('*')
 *
 * // src/commands/store/graph.ts — scoped access
 * export default defineCommandGraph({
 *   catalog: true,                                        // all catalog commands
 *   customer: ['create', 'update'],                       // only create + update
 *   order: (auth) => ({ customer_id: auth.id }),          // all commands, scoped to user
 * })
 * ```
 */
export function defineCommandGraph(access: '*'): CommandGraphDefinition
export function defineCommandGraph(access: Record<ModuleNameArg, CommandAccessRule>): CommandGraphDefinition
export function defineCommandGraph(access: '*' | Record<ModuleNameArg, CommandAccessRule>): CommandGraphDefinition {
  if (access !== '*' && (typeof access !== 'object' || access === null)) {
    throw new MantaError('INVALID_DATA', 'defineCommandGraph() requires "*" or a module access map')
  }
  if (typeof access === 'object' && Object.keys(access).length === 0) {
    throw new MantaError('INVALID_DATA', 'defineCommandGraph() module map cannot be empty. Use "*" for full access.')
  }

  return {
    __type: 'command-graph',
    access,
  }
}

/**
 * Check if a module is allowed by the command graph definition.
 */
export function isModuleAllowed(def: CommandGraphDefinition, moduleName: string): boolean {
  if (def.access === '*') return true
  return moduleName in def.access
}

/**
 * Check if a specific command operation is allowed for a module.
 * @param def - Command graph definition
 * @param moduleName - Module name (e.g. 'catalog')
 * @param operation - Command operation (e.g. 'create', 'update', 'delete', or custom name)
 * @returns true if allowed, false if blocked
 */
export function isCommandAllowed(def: CommandGraphDefinition, moduleName: string, operation: string): boolean {
  if (def.access === '*') return true
  const rule = def.access[moduleName]
  if (rule === undefined) return false
  if (rule === true) return true
  if (Array.isArray(rule)) return rule.includes(operation)
  // Function rule = all commands allowed (scoping is applied at execution time)
  if (typeof rule === 'function') return true
  return false
}

/**
 * Get the row-level scope for a module's commands, given the auth context.
 * Returns undefined if no scope (wildcard, `true`, or array rule).
 * Returns the scope record if a function rule is defined.
 * Returns null if module is not allowed.
 */
export function getCommandScope(
  def: CommandGraphDefinition,
  moduleName: string,
  auth: AuthContext | null,
): Record<string, unknown> | undefined | null {
  if (def.access === '*') return undefined // no scope
  const rule = def.access[moduleName]
  if (rule === undefined) return null // not allowed
  if (rule === true || Array.isArray(rule)) return undefined // no scope
  if (!auth) return null // scoped module but no auth → blocked
  return rule(auth)
}
