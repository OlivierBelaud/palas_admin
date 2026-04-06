// ContextRegistry — stores, validates, and resolves contexts at boot.

import { MantaError } from '../errors/manta-error'
import type { AiContextConfig, ContextDefinition, ResolvedContext } from './index'

export class ContextRegistry {
  private _contexts = new Map<string, ResolvedContext>()

  /**
   * Register a context definition. Validates module/command refs against available names.
   * Throws on duplicate basePath + actor conflict.
   */
  register(def: ContextDefinition, availableModules: string[], availableCommands: string[]): void {
    const actors = Array.isArray(def.actors) ? def.actors : [def.actors]

    // Validate module references
    const modules = new Map<string, { methods: '*' | string[]; public: boolean }>()
    for (const [moduleName, config] of Object.entries(def.modules)) {
      if (config === undefined) continue
      if (!availableModules.includes(moduleName)) {
        throw new MantaError(
          'INVALID_DATA',
          `Context "${def.name}": module "${moduleName}" not found. Available: ${availableModules.join(', ')}`,
        )
      }
      if (config === '*') {
        modules.set(moduleName, { methods: '*', public: false })
      } else {
        modules.set(moduleName, {
          methods: config.expose,
          public: config.public ?? false,
        })
      }
    }

    // Validate command references
    const commands = new Set<string>()
    if (def.commands) {
      for (const cmdName of def.commands) {
        if (!availableCommands.includes(cmdName)) {
          throw new MantaError(
            'INVALID_DATA',
            `Context "${def.name}": command "${cmdName}" not found. Available: ${availableCommands.join(', ')}`,
          )
        }
        commands.add(cmdName)
      }
    }

    // Check for basePath + actor conflicts
    for (const [, existing] of this._contexts) {
      if (existing.basePath === def.basePath) {
        const overlap = actors.filter((a) => existing.actors.includes(a))
        if (overlap.length > 0) {
          throw new MantaError(
            'DUPLICATE_ERROR',
            `Context "${def.name}" conflicts with "${existing.name}": same basePath "${def.basePath}" and actor(s) "${overlap.join(', ')}"`,
          )
        }
      }
    }

    // Resolve AI config
    let ai: { enabled: boolean; commands: string[] }
    if (def.ai === true) {
      ai = { enabled: true, commands: [...commands] }
    } else if (def.ai && typeof def.ai === 'object') {
      const aiConfig = def.ai as AiContextConfig
      ai = {
        enabled: aiConfig.enabled,
        commands: aiConfig.commands ?? [...commands],
      }
    } else {
      ai = { enabled: false, commands: [] }
    }

    this._contexts.set(def.name, {
      name: def.name,
      basePath: def.basePath,
      actors,
      modules,
      commands,
      ai,
    })
  }

  /**
   * Register the implicit admin context (when no src/contexts/ exists).
   * All modules, all commands, AI enabled.
   */
  registerDefault(availableModules: string[], availableCommands: string[]): void {
    const modules = new Map<string, { methods: '*' | string[]; public: boolean }>()
    for (const name of availableModules) {
      modules.set(name, { methods: '*', public: false })
    }

    this._contexts.set('admin', {
      name: 'admin',
      basePath: '/api/admin',
      actors: ['user'],
      modules,
      commands: new Set(availableCommands),
      ai: { enabled: true, commands: [...availableCommands] },
    })
  }

  /**
   * Resolve a context from request pathname + actor type.
   * Matches by basePath prefix, then checks actor is allowed.
   */
  resolve(pathname: string, actorType: string): ResolvedContext | null {
    for (const [, ctx] of this._contexts) {
      if (pathname.startsWith(ctx.basePath)) {
        if (ctx.actors.includes(actorType) || ctx.actors.includes('*')) {
          return ctx
        }
      }
    }
    return null
  }

  /** List all registered contexts. */
  list(): ResolvedContext[] {
    return [...this._contexts.values()]
  }

  /** Get a context by name. */
  get(name: string): ResolvedContext | undefined {
    return this._contexts.get(name)
  }

  /** Check if a command is visible in a context. */
  isCommandVisible(contextName: string, commandName: string): boolean {
    const ctx = this._contexts.get(contextName)
    if (!ctx) return false
    return ctx.commands.has(commandName)
  }

  /** Check if a module is exposed in a context. */
  isModuleExposed(contextName: string, moduleName: string): boolean {
    const ctx = this._contexts.get(contextName)
    if (!ctx) return false
    return ctx.modules.has(moduleName)
  }

  /** Check if a module is public (no auth required) in a context. */
  isPublicModule(contextName: string, moduleName: string): boolean {
    const ctx = this._contexts.get(contextName)
    if (!ctx) return false
    const mod = ctx.modules.get(moduleName)
    return mod?.public ?? false
  }

  /** Get AI-visible commands for a context. */
  getAiCommands(contextName: string): string[] {
    const ctx = this._contexts.get(contextName)
    if (!ctx || !ctx.ai.enabled) return []
    return ctx.ai.commands
  }
}
