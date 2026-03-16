// SPEC-002 — Container types and registration keys

/**
 * Service lifetime controls how instances are created and shared.
 * - SINGLETON: One instance for the entire container lifetime
 * - SCOPED: One instance per scope (request scope)
 * - TRANSIENT: New instance every time resolve() is called
 */
export type ServiceLifetime = 'SINGLETON' | 'SCOPED' | 'TRANSIENT'

/**
 * Container DI contract — SPEC-001.
 * All implementations (Awilix-based, InMemory) must satisfy this interface.
 */
export interface IContainer {
  /** UUID v4 unique per container/scope instance */
  id: string

  /**
   * Resolve a service by key.
   * @param key - The registration key
   * @returns The resolved service instance
   * @throws MantaError(NOT_FOUND) if key not registered
   * @throws MantaError(INVALID_STATE) if container is disposed
   * @throws MantaError(INVALID_STATE) if SCOPED service resolved outside active scope
   */
  resolve<T>(key: string): T

  /**
   * Register a service with a given lifetime.
   * @param key - The registration key
   * @param value - The service instance, factory function, or class
   * @param lifetime - Service lifetime (default: SINGLETON)
   */
  register(key: string, value: unknown, lifetime?: ServiceLifetime): void

  /**
   * Create a child scope that inherits parent singletons.
   * @returns A new scoped container
   */
  createScope(): IContainer

  /**
   * Accumulate values under a single key (resolved as array).
   * @param key - The accumulation key
   * @param value - The value to add
   */
  registerAdd(key: string, value: unknown): void

  /**
   * Create an alias that resolves to another registration.
   * @param alias - The alias key
   * @param target - The target registration key
   */
  aliasTo(alias: string, target: string): void

  /**
   * Dispose the container and all SINGLETON services.
   * Idempotent. Does NOT wait for active scopes.
   * TRANSIENT instances are NOT disposed.
   */
  dispose(): Promise<void>
}

/**
 * Well-known container registration keys.
 */
export const ContainerRegistrationKeys = {
  CACHE: 'ICachePort',
  EVENT_BUS: 'IEventBusPort',
  LOCKING: 'ILockingPort',
  LOGGER: 'ILoggerPort',
  AUTH: 'IAuthPort',
  AUTH_MODULE: 'IAuthModuleService',
  AUTH_GATEWAY: 'IAuthGateway',
  MESSAGE_AGGREGATOR: 'IMessageAggregator',
  WORKFLOW_STORAGE: 'IWorkflowStoragePort',
  WORKFLOW_ENGINE: 'IWorkflowEnginePort',
  FILE: 'IFilePort',
  DATABASE: 'IDatabasePort',
  JOB_SCHEDULER: 'IJobSchedulerPort',
  NOTIFICATION: 'INotificationPort',
  TRANSLATION: 'ITranslationPort',
  HTTP: 'IHttpPort',
} as const
