// Context system — distribution layer for modules/commands/AI per consumer.

import { MantaError } from '../errors/manta-error'

// ── Registry interface (augmented by .manta/types/registry.d.ts codegen) ──

/**
 * MantaRegistry — the single source of truth for all discoverable names.
 * Augmented at dev time by codegen. When empty, falls back to string.
 *
 * @example (generated)
 * declare module '@manta/core' {
 *   interface MantaRegistry {
 *     modules: { catalog: true; inventory: true }
 *     commands: { 'create-product': true; checkout: true }
 *     actors: { user: true; customer: true }
 *   }
 * }
 */
// Intersection (rather than extends) so codegen-augmented MantaGeneratedRegistry
// can redefine modules/commands/actors with narrower non-optional types without
// triggering a structural incompatibility with the base.
export type MantaRegistry = {
  modules?: Record<string, true>
  commands?: Record<string, true>
  actors?: Record<string, true>
} & MantaGeneratedRegistry

// Conditional types: use strict union when codegen has populated the registry, else fall back to string.
type RegistryKeys<K extends keyof MantaRegistry> =
  MantaRegistry[K] extends Record<string, true> ? Extract<keyof MantaRegistry[K], string> : string

export type ModuleName = RegistryKeys<'modules'>
export type CommandName = RegistryKeys<'commands'>
export type ActorType = RegistryKeys<'actors'>

// ── Module expose config ──

/**
 * Module expose configuration within a context.
 */
export interface ModuleExposeConfig {
  /** '*' = all methods, or array of method names */
  expose: '*' | string[]
  /** true = no authentication required for this module's queries */
  public?: boolean
}

// ── AI config ──

/**
 * AI configuration for a context.
 */
export interface AiContextConfig {
  enabled: boolean
  /** Restrict AI to specific commands (default: all commands in the context) */
  commands?: CommandName[]
}

// ── Context definition ──

/**
 * Context definition — declares how modules/commands are exposed to a consumer.
 *
 * All names are typed via MantaRegistry (auto-generated).
 * IDE autocomplete works out of the box when `manta dev` has run.
 *
 * @example
 * export default defineContext({
 *   name: 'store',
 *   basePath: '/api/store',
 *   actors: ['customer'],
 *   modules: {
 *     catalog: { expose: '*', public: true },
 *     cart: { expose: '*' },
 *   },
 *   commands: ['checkout'],
 *   ai: { enabled: true, commands: ['checkout'] },
 * })
 */
export interface ContextDefinition {
  name: string
  basePath: string
  actors: ActorType | ActorType[]
  modules: Partial<Record<ModuleName, ModuleExposeConfig | '*'>>
  commands?: CommandName[]
  ai?: boolean | AiContextConfig
}

/**
 * Resolved context — populated at boot after validation.
 */
export interface ResolvedContext {
  name: string
  basePath: string
  actors: string[]
  modules: Map<string, { methods: '*' | string[]; public: boolean }>
  commands: Set<string>
  ai: { enabled: boolean; commands: string[] }
}

/**
 * Define a typed context.
 * Module/command/actor names are autocompleted via MantaRegistry and validated at boot.
 *
 * @deprecated In V2, folder structure determines contexts. Move commands to
 * `src/commands/{contextName}/` and queries to `src/queries/{contextName}/`.
 * Use `defineUserModel(contextName)` to define user types.
 * See ARCHITECTURE_V2.md for migration details.
 */
export function defineContext(config: ContextDefinition): ContextDefinition {
  console.warn(
    `[Manta] defineContext('${config.name}') is deprecated. In V2, folder structure determines contexts. ` +
      `Move commands to src/commands/${config.name}/ and queries to src/queries/${config.name}/. ` +
      'See ARCHITECTURE_V2.md for details.',
  )
  if (!config.name) throw new MantaError('INVALID_DATA', 'Context name is required')
  if (!config.basePath) throw new MantaError('INVALID_DATA', 'Context basePath is required')
  if (!config.actors || (Array.isArray(config.actors) && config.actors.length === 0)) {
    throw new MantaError('INVALID_DATA', 'Context actors must be a non-empty string or array')
  }
  return config
}

export { ContextRegistry } from './registry'
