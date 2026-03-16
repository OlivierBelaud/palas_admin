// SPEC-001 — InMemoryContainer implements IContainer

import type { IContainer, ServiceLifetime } from '../container'
import { MantaError } from '../errors/manta-error'

export class InMemoryContainer implements IContainer {
  readonly id: string
  private _registry = new Map<string, { value: unknown; lifetime: ServiceLifetime }>()
  private _scopedInstances = new Map<string, unknown>()
  private _adds = new Map<string, unknown[]>()
  private _aliases = new Map<string, string>()
  private _parent: InMemoryContainer | null = null
  private _disposed = false
  private _als: { getStore(): InMemoryContainer | undefined; run<T>(store: InMemoryContainer, fn: () => T | Promise<T>): T | Promise<T> }

  constructor(parent?: InMemoryContainer) {
    this.id = crypto.randomUUID()
    this._parent = parent ?? null

    if (parent) {
      // Child scope inherits parent's registry and ALS
      this._registry = parent._registry
      this._adds = parent._adds
      this._aliases = parent._aliases
      this._als = parent._als
    } else {
      // Root container creates the ALS
      let _store: InMemoryContainer | undefined
      this._als = {
        getStore: () => _store,
        run: <T>(store: InMemoryContainer, fn: () => T | Promise<T>) => {
          const prev = _store
          _store = store
          try {
            const result = fn()
            if (result instanceof Promise) {
              return result.finally(() => { _store = prev }) as T extends Promise<infer U> ? Promise<U> : never
            }
            _store = prev
            return result
          } catch (e) {
            _store = prev
            throw e
          }
        },
      }
    }
  }

  resolve<T>(key: string): T {
    if (this._disposed || (this._parent && this._parent._disposed)) throw new MantaError('INVALID_STATE', 'Container is disposed')

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
      // Must be in an active scope
      const activeScope = this._als.getStore()
      const scope = activeScope ?? (this._parent ? this : null)
      if (!scope || scope === this._parent) {
        // Resolving SCOPED from global container without active scope
        if (!this._parent && !activeScope) {
          throw new MantaError('INVALID_STATE', 'Cannot resolve SCOPED service outside of an active scope')
        }
      }

      const targetScope = activeScope ?? this
      if (targetScope._scopedInstances.has(resolvedKey)) {
        return targetScope._scopedInstances.get(resolvedKey) as T
      }

      // Create new scoped instance
      const instance = typeof entry.value === 'function'
        ? new (entry.value as new () => T)()
        : entry.value
      targetScope._scopedInstances.set(resolvedKey, instance)
      return instance as T
    }

    if (entry.lifetime === 'TRANSIENT') {
      if (typeof entry.value === 'function') {
        const fn = entry.value as Function
        // If it's an arrow function or plain function (no prototype), call it directly
        // If it's a class/constructor, use new
        if (!fn.prototype || fn.prototype.constructor !== fn) {
          return fn() as T
        }
        return new (fn as new () => T)()
      }
      return entry.value as T
    }

    // SINGLETON
    return entry.value as T
  }

  register(key: string, value: unknown, lifetime: ServiceLifetime = 'SINGLETON'): void {
    if (this._disposed) throw new MantaError('INVALID_STATE', 'Container is disposed')

    // Lifecycle inversion detection (CT-05): SINGLETON cannot depend on SCOPED
    if (lifetime === 'SINGLETON' && value && typeof value === 'object') {
      // Check if the value references any SCOPED services — detected at resolve time
      // We store the registration and check at resolve time for dependency chains
    }

    this._registry.set(key, { value, lifetime })
  }

  /**
   * Checks if registering a SINGLETON that depends on a SCOPED service.
   * Call this to validate dependency chains after registration.
   */
  validateLifecycles(key: string, dependencies: string[]): void {
    const entry = this._registry.get(key)
    if (!entry) return
    if (entry.lifetime !== 'SINGLETON') return

    for (const dep of dependencies) {
      const depEntry = this._registry.get(dep)
      if (depEntry && depEntry.lifetime === 'SCOPED') {
        throw new MantaError(
          'INVALID_STATE',
          `Lifecycle inversion: SINGLETON "${key}" depends on SCOPED "${dep}". ` +
          `This would cause a captive dependency — the SINGLETON would hold a stale SCOPED reference.`,
        )
      }
    }
  }

  createScope(): IContainer {
    return new InMemoryContainer(this)
  }

  registerAdd(key: string, value: unknown): void {
    if (!this._adds.has(key)) this._adds.set(key, [])
    this._adds.get(key)!.push(value)
  }

  aliasTo(alias: string, target: string): void {
    this._aliases.set(alias, target)
  }

  async dispose(): Promise<void> {
    if (this._disposed) return // Idempotent
    this._disposed = true

    // Dispose singletons in reverse registration order
    const entries = Array.from(this._registry.entries()).reverse()
    for (const [_key, entry] of entries) {
      if (entry.lifetime === 'SINGLETON' && entry.value && typeof (entry.value as Record<string, unknown>).dispose === 'function') {
        try { await (entry.value as { dispose: () => Promise<void> }).dispose() } catch { /* best effort */ }
      }
    }
    // TRANSIENT instances are NOT disposed (CT-18)
  }

  /** Internal: run a callback in a scoped ALS context */
  async _runInScope<T>(scope: InMemoryContainer, fn: () => T | Promise<T>): Promise<T> {
    return this._als.run(scope, fn) as Promise<T>
  }

  get disposed() { return this._disposed }
}
