// SPEC-001 — IContainer implementation with Awilix + AsyncLocalStorage

import { MantaError } from '../errors/manta-error'
import type { IContainer, ServiceLifetime } from './types'
import { containerALS } from './scoped-work'

interface RegistryEntry {
  value: unknown
  lifetime: ServiceLifetime
}

/**
 * DI container backed by a Map registry with ALS-based scoping.
 * SINGLETON instances are stored directly in the registry.
 * SCOPED instances are stored per-scope in _scopedInstances.
 * TRANSIENT instances are created on every resolve() and NOT tracked.
 */
export class MantaContainer implements IContainer {
  readonly id: string
  private _registry = new Map<string, RegistryEntry>()
  private _scopedInstances = new Map<string, unknown>()
  private _adds = new Map<string, unknown[]>()
  private _aliases = new Map<string, string>()
  private _parent: MantaContainer | null = null
  private _disposed = false

  constructor(parent?: MantaContainer) {
    this.id = crypto.randomUUID()
    this._parent = parent ?? null

    if (parent) {
      // Child scope shares parent's registry, adds, and aliases
      this._registry = parent._registry
      this._adds = parent._adds
      this._aliases = parent._aliases
    }
  }

  /**
   * Resolve a service by key.
   * @param key - The registration key
   * @returns The resolved service instance
   */
  resolve<T>(key: string): T {
    if (this._disposed || (this._parent && this._parent._disposed)) {
      throw new MantaError('INVALID_STATE', 'Container is disposed')
    }

    // Check alias
    const resolvedKey = this._aliases.get(key) ?? key

    // Check registerAdd
    if (this._adds.has(resolvedKey)) {
      return this._adds.get(resolvedKey) as T
    }

    const entry = this._registry.get(resolvedKey)
    if (!entry) {
      throw new MantaError('NOT_FOUND', `Service "${resolvedKey}" not registered`)
    }

    if (entry.lifetime === 'SCOPED') {
      const activeScope = containerALS.getStore() as MantaContainer | undefined
      const scope = activeScope ?? (this._parent ? this : null)
      if (!scope || scope === this._parent) {
        if (!this._parent && !activeScope) {
          throw new MantaError('INVALID_STATE', 'Cannot resolve SCOPED service outside of an active scope')
        }
      }

      const targetScope = (activeScope ?? this) as MantaContainer
      if (targetScope._scopedInstances.has(resolvedKey)) {
        return targetScope._scopedInstances.get(resolvedKey) as T
      }

      // Create new scoped instance
      const instance = this._instantiate<T>(entry.value)
      targetScope._scopedInstances.set(resolvedKey, instance)
      return instance
    }

    if (entry.lifetime === 'TRANSIENT') {
      return this._instantiate<T>(entry.value)
    }

    // SINGLETON
    return entry.value as T
  }

  /**
   * Register a service with a given lifetime.
   * @param key - The registration key
   * @param value - The service instance, factory, or class
   * @param lifetime - Service lifetime (default: SINGLETON)
   */
  register(key: string, value: unknown, lifetime: ServiceLifetime = 'SINGLETON'): void {
    if (this._disposed) {
      throw new MantaError('INVALID_STATE', 'Container is disposed')
    }
    this._registry.set(key, { value, lifetime })
  }

  /**
   * Create a child scope inheriting parent singletons.
   * @returns A new scoped container
   */
  createScope(): IContainer {
    return new MantaContainer(this)
  }

  /**
   * Accumulate values under a single key.
   * @param key - The accumulation key
   * @param value - The value to add
   */
  registerAdd(key: string, value: unknown): void {
    if (!this._adds.has(key)) this._adds.set(key, [])
    this._adds.get(key)!.push(value)
  }

  /**
   * Create an alias that resolves to another key.
   * @param alias - The alias key
   * @param target - The target key
   */
  aliasTo(alias: string, target: string): void {
    this._aliases.set(alias, target)
  }

  /**
   * Dispose the container. Idempotent.
   * Disposes SINGLETON services in reverse registration order.
   * TRANSIENT instances are NOT tracked and NOT disposed.
   */
  async dispose(): Promise<void> {
    if (this._disposed) return
    this._disposed = true

    const entries = Array.from(this._registry.entries()).reverse()
    for (const [, entry] of entries) {
      if (
        entry.lifetime === 'SINGLETON' &&
        entry.value &&
        typeof (entry.value as Record<string, unknown>).dispose === 'function'
      ) {
        try {
          await (entry.value as { dispose: () => Promise<void> }).dispose()
        } catch {
          // Best effort
        }
      }
    }
  }

  /** @returns Whether the container has been disposed */
  get disposed(): boolean {
    return this._disposed
  }

  /**
   * Instantiate a value — call as factory if arrow/plain function, new if class.
   */
  private _instantiate<T>(value: unknown): T {
    if (typeof value === 'function') {
      const fn = value as Function
      if (!fn.prototype || fn.prototype.constructor !== fn) {
        return fn() as T
      }
      return new (fn as new () => T)()
    }
    return value as T
  }
}
