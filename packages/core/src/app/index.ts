export { getRequestContext, type RequestContext, runInRequestContext } from './request-context'

// MantaApp — typed application object.
// app.modules.product.list() with full autocompletion.
// Modules are isolated: they receive deps directly, never the app object.

import type { CommandRegistry } from '../command'
import type { CommandDefinition } from '../command/types'
import { MantaError } from '../errors/manta-error'
import type { MantaEventMap } from '../events/types'
import type { ICachePort } from '../ports/cache'
import type { IEventBusPort } from '../ports/event-bus'
import type { IFilePort } from '../ports/file'
import type { ILockingPort } from '../ports/locking'
import type { ILoggerPort } from '../ports/logger'

// ── Types ──────────────────────────────────────

export interface MantaInfra {
  eventBus: IEventBusPort
  logger: ILoggerPort
  cache: ICachePort
  locking: ILockingPort
  file: IFilePort
}

/**
 * Internal infra — includes db access. Not part of public API.
 * @internal
 */
export interface MantaInfraInternal extends MantaInfra {
  // biome-ignore lint/suspicious/noExplicitAny: database adapter varies
  db: any
}

/**
 * The Manta application object.
 *
 * @example
 * export async function GET(req: MantaRequest) {
 *   const products = await req.app.modules.product.list()
 *   await req.app.workflows.createProductPipeline({ title: 'New' })
 * }
 */
/**
 * Module type registry — augmented by .manta/types/app.d.ts codegen.
 * When codegen runs, `app.modules.catalog.listProducts()` gets full autocomplete.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by codegen via declare global
export interface MantaAppModules extends MantaGeneratedAppModules, Record<string, unknown> {}

export interface MantaApp<
  TModules extends Record<string, unknown> = MantaAppModules,
  TWorkflows extends Record<string, (...args: unknown[]) => Promise<unknown>> = Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >,
  TCommands extends Record<string, (input: unknown) => Promise<unknown>> = Record<
    string,
    (input: unknown) => Promise<unknown>
  >,
> {
  /** Unique app instance ID (for correlation/debugging) */
  id: string
  /** Module services — typed, with autocompletion */
  modules: TModules
  /** Workflow functions */
  workflows: TWorkflows
  /** Command callables — CQRS mutations */
  commands: TCommands
  /** Framework infrastructure */
  infra: MantaInfra
  /** Emit a known event with typed data (from MantaEventMap codegen). */
  emit<E extends keyof MantaEventMap>(eventName: E, data: MantaEventMap[E]): Promise<void>
  /** Emit an event — shortcut for app.infra.eventBus.emit() */
  emit(eventName: string, data: unknown): Promise<void>
  /** Dynamic access by key (Medusa compat) */
  resolve<T = unknown>(key: string): T
  /** Graceful shutdown — disposes all disposable infra */
  dispose(): Promise<void>
}

// ── Builder (production) ───────────────────────

export interface MantaAppOptions {
  infra: MantaInfra | MantaInfraInternal
}

export function createApp(options: MantaAppOptions): MantaAppBuilder {
  return new MantaAppBuilder(options)
}

export class MantaAppBuilder {
  private _modules = new Map<string, unknown>()
  // biome-ignore lint/suspicious/noExplicitAny: workflow functions are dynamic
  private _workflows = new Map<string, (...args: any[]) => Promise<unknown>>()
  private _commands = new Map<string, (input: unknown) => Promise<unknown>>()
  private _commandRegistry: CommandRegistry | null = null
  private _extraResolve = new Map<string, unknown>()
  private _infra: MantaInfra
  private _frozen = false

  constructor(options: MantaAppOptions) {
    this._infra = options.infra
  }

  registerModule(name: string, service: unknown): void {
    if (this._frozen) throw new MantaError('INVALID_STATE', 'App is frozen — cannot register after boot')
    if (this._modules.has(name)) {
      throw new MantaError(
        'DUPLICATE_ERROR',
        `Module "${name}" is already registered. Each module name must be unique. Check your src/modules/ directory for duplicates.`,
      )
    }
    this._modules.set(name, service)
  }

  // biome-ignore lint/suspicious/noExplicitAny: workflow functions are dynamic
  registerWorkflow(name: string, fn: (...args: any[]) => Promise<unknown>): void {
    if (this._frozen) throw new MantaError('INVALID_STATE', 'App is frozen — cannot register after boot')
    this._workflows.set(name, fn)
  }

  /** Register a command definition in the registry */
  // biome-ignore lint/suspicious/noExplicitAny: commands have varied type params
  registerCommand(def: CommandDefinition<any, any>): void {
    if (this._frozen) throw new MantaError('INVALID_STATE', 'App is frozen — cannot register after boot')
    if (!this._commandRegistry) {
      // Lazy import to avoid circular — CommandRegistry is pure domain
      const { CommandRegistry: CR } = require('../command')
      this._commandRegistry = new CR()
    }
    this._commandRegistry!.register(def)
  }

  /** Register a command callable (with infra wired in by bootstrap) */
  registerCommandCallable(name: string, fn: (input: unknown) => Promise<unknown>): void {
    if (this._frozen) throw new MantaError('INVALID_STATE', 'App is frozen — cannot register after boot')
    this._commands.set(name, fn)
  }

  /** Get the command registry (for bootstrap to wire callables) */
  getCommandRegistry(): CommandRegistry | null {
    return this._commandRegistry
  }

  /** Register extra keys accessible via resolve() (e.g. IJobSchedulerPort) */
  registerInfra(key: string, value: unknown): void {
    if (this._frozen) throw new MantaError('INVALID_STATE', 'App is frozen — cannot register after boot')
    this._extraResolve.set(key, value)
  }

  build<
    TModules extends Record<string, unknown> = Record<string, unknown>,
    TWorkflows extends Record<string, (...args: unknown[]) => Promise<unknown>> = Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >,
    TCommands extends Record<string, (input: unknown) => Promise<unknown>> = Record<
      string,
      (input: unknown) => Promise<unknown>
    >,
  >(): MantaApp<TModules, TWorkflows, TCommands> {
    this._frozen = true
    return buildApp<TModules, TWorkflows, TCommands>(
      this._modules,
      this._workflows,
      this._commands,
      this._commandRegistry,
      this._extraResolve,
      this._infra,
    )
  }
}

// ── TestMantaApp (mutable, for tests) ──────────

/**
 * Mutable MantaApp for tests — supports register() after creation.
 * Production apps are frozen. Test apps are mutable.
 */
export interface TestMantaApp extends MantaApp {
  /** Register a service dynamically (test-only) */
  register(key: string, value: unknown): void
  /** Register a command callable (test-only) */
  registerCommand(name: string, fn: (input: unknown) => Promise<unknown>): void
}

/**
 * Create a mutable MantaApp for tests.
 * Supports post-creation registration via app.register().
 */
export function createTestMantaApp(options: MantaAppOptions): TestMantaApp {
  const resolveMap = new Map<string, unknown>()
  const modules: Record<string, unknown> = {}
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  const workflows: Record<string, any> = {}
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  const commands: Record<string, any> = {}

  // Register infra
  registerInfraInMap(resolveMap, options.infra)

  const app: TestMantaApp = {
    id: crypto.randomUUID(),
    modules: modules as MantaAppModules,
    workflows,
    commands,
    infra: options.infra,
    async emit(eventName: string, data: unknown): Promise<void> {
      await options.infra.eventBus.emit({
        eventName,
        data,
        metadata: { timestamp: Date.now() },
      })
    },
    resolve<T = unknown>(key: string): T {
      const value = resolveMap.get(key)
      if (value === undefined) {
        throw new MantaError(
          'UNKNOWN_MODULES',
          `Cannot resolve '${key}'. Available: ${[...resolveMap.keys()].join(', ')}`,
        )
      }
      return value as T
    },
    register(key: string, value: unknown): void {
      resolveMap.set(key, value)
      // Also update modules/workflows if applicable
      if (!key.includes('Port') && !key.includes('__') && typeof value !== 'function') {
        modules[key] = value
      }
    },
    registerCommand(name: string, fn: (input: unknown) => Promise<unknown>): void {
      commands[name] = fn
    },
    async dispose(): Promise<void> {
      for (const [_, val] of resolveMap) {
        if (val && typeof (val as Record<string, unknown>).dispose === 'function') {
          try {
            await (val as { dispose: () => Promise<void> }).dispose()
          } catch {
            /* best effort */
          }
        }
      }
    },
  }

  return app
}

// ── Internal helpers ───────────────────────────

function registerInfraInMap(resolveMap: Map<string, unknown>, infra: MantaInfra | MantaInfraInternal): void {
  resolveMap.set('IEventBusPort', infra.eventBus)
  resolveMap.set('event_bus', infra.eventBus)
  resolveMap.set('eventBusModuleService', infra.eventBus)
  resolveMap.set('ILoggerPort', infra.logger)
  resolveMap.set('logger', infra.logger)
  resolveMap.set('ICachePort', infra.cache)
  resolveMap.set('cache', infra.cache)
  resolveMap.set('ILockingPort', infra.locking)
  resolveMap.set('IFilePort', infra.file)
  // db is internal-only — accessible via resolve('db') but not on public MantaInfra
  if ('db' in infra) resolveMap.set('db', infra.db)
}

function buildApp<
  TModules extends Record<string, unknown>,
  TWorkflows extends Record<string, (...args: unknown[]) => Promise<unknown>>,
  TCommands extends Record<string, (input: unknown) => Promise<unknown>>,
>(
  modulesMap: Map<string, unknown>,
  workflowsMap: Map<string, Function>,
  commandsMap: Map<string, (input: unknown) => Promise<unknown>>,
  commandRegistry: CommandRegistry | null,
  extraResolve: Map<string, unknown>,
  infra: MantaInfra,
): MantaApp<TModules, TWorkflows, TCommands> {
  const appId = crypto.randomUUID()

  // Build modules
  const modules: Record<string, unknown> = {}
  for (const [name, service] of modulesMap) {
    modules[name] = service
    const camelCase = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    if (camelCase !== name) modules[camelCase] = service
  }
  Object.freeze(modules)

  // Build workflows
  // biome-ignore lint/suspicious/noExplicitAny: dynamic workflow functions
  const workflows: Record<string, any> = {}
  for (const [name, fn] of workflowsMap) {
    workflows[name] = fn
  }
  Object.freeze(workflows)

  // Build commands
  // biome-ignore lint/suspicious/noExplicitAny: dynamic command functions
  const commands: Record<string, any> = {}
  for (const [name, fn] of commandsMap) {
    const camelCase = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    commands[camelCase] = fn
  }
  Object.freeze(commands)

  // Resolve map
  const resolveMap = new Map<string, unknown>()
  for (const [name, service] of modulesMap) {
    resolveMap.set(name, service)
    resolveMap.set(`${name}ModuleService`, service)
  }
  resolveMap.set('workflows', workflows)
  if (commandRegistry) resolveMap.set('commandRegistry', commandRegistry)
  registerInfraInMap(resolveMap, infra)
  for (const [key, value] of extraResolve) {
    resolveMap.set(key, value)
  }

  const app: MantaApp<TModules, TWorkflows, TCommands> = {
    id: appId,
    modules: modules as TModules,
    workflows: workflows as TWorkflows,
    commands: commands as TCommands,
    infra: Object.freeze({ ...infra }),
    async emit(eventName: string, data: unknown): Promise<void> {
      await infra.eventBus.emit({
        eventName,
        data,
        metadata: { timestamp: Date.now() },
      })
    },
    resolve<T = unknown>(key: string): T {
      const value = resolveMap.get(key)
      if (value === undefined) {
        throw new MantaError(
          'UNKNOWN_MODULES',
          `Cannot resolve '${key}'. Available: ${[...resolveMap.keys()].filter((k) => !k.includes('Port')).join(', ')}`,
        )
      }
      return value as T
    },
    async dispose(): Promise<void> {
      for (const [_, val] of resolveMap) {
        if (val && typeof (val as Record<string, unknown>).dispose === 'function') {
          try {
            await (val as { dispose: () => Promise<void> }).dispose()
          } catch {
            /* best effort */
          }
        }
      }
    },
  }

  return Object.freeze(app) as MantaApp<TModules, TWorkflows, TCommands>
}
