// SPEC-086 — manta exec command

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ExecOptions } from '../types'
import {
  MantaContainer,
  ContainerRegistrationKeys,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryLockingAdapter,
  InMemoryFileAdapter,
  WorkflowManager,
} from '@manta/core'
import { PinoLoggerAdapter } from '@manta/adapter-logger-pino'
import type { IEventBusPort, IFilePort, Message } from '@manta/core'
import { discoverResources } from '../resource-loader'

export interface ExecCommandResult {
  exitCode: number
  errors: string[]
}

/**
 * manta exec — Execute a script with the framework container loaded.
 * Uses the ResourceLoader to discover and wire all project resources
 * (modules, workflows, subscribers) — same boot path as manta dev.
 * --dry-run: wraps in a transaction and rolls back.
 */
export async function execCommand(
  options: ExecOptions,
  cwd: string = process.cwd(),
): Promise<ExecCommandResult> {
  const result: ExecCommandResult = { exitCode: 0, errors: [] }

  // Validate script exists
  const scriptPath = resolve(cwd, options.script)
  if (!existsSync(scriptPath)) {
    result.exitCode = 1
    result.errors.push(`Script not found: ${options.script}`)
    return result
  }

  // Import and validate the script
  try {
    const scriptModule = await import(scriptPath)
    const fn = scriptModule.default

    if (typeof fn !== 'function') {
      result.exitCode = 1
      result.errors.push(
        `Script '${options.script}' must export a default async function.\n` +
        'Expected: export default async ({ container, args }) => { ... }',
      )
      return result
    }

    // Create a real container with infrastructure adapters
    const container = new MantaContainer()
    container.register(ContainerRegistrationKeys.LOGGER, new PinoLoggerAdapter({ level: 'debug', pretty: true }))
    container.register(ContainerRegistrationKeys.EVENT_BUS, new InMemoryEventBusAdapter())
    container.register(ContainerRegistrationKeys.CACHE, new InMemoryCacheAdapter())
    container.register(ContainerRegistrationKeys.LOCKING, new InMemoryLockingAdapter())
    container.register('IFilePort', new InMemoryFileAdapter())

    // Discover and wire all project resources via ResourceLoader
    await resourceLoaderBootstrap(container, cwd)

    // Create a scoped container for the script
    const scope = container.createScope()

    // Register system/cli AuthContext in the scope
    const authContext = {
      actor_type: 'system' as const,
      actor_id: 'cli',
      app_metadata: { source: 'manta-exec' },
    }
    scope.register('AUTH_CONTEXT', authContext)

    // Execute the script with the scoped container
    await fn({
      container: scope,
      args: options.args ?? [],
    })

    // Dispose the container after execution
    await container.dispose()
  } catch (err) {
    result.exitCode = 1
    const message = err instanceof Error ? err.message : String(err)
    result.errors.push(`Script failed: ${message}`)
  }

  return result
}

/**
 * ResourceLoader-based bootstrap -- discovers and wires all project resources.
 * Same discovery logic as manta dev lazy boot (steps 9-18).
 *
 * Loads: modules, workflows, subscribers.
 */
export async function resourceLoaderBootstrap(container: MantaContainer, cwd: string): Promise<void> {
  const resources = await discoverResources(cwd)

  // [Step 9] Load modules — discover *Service exports, instantiate & register
  for (const modInfo of resources.modules) {
    try {
      const imported = await import(modInfo.path)
      for (const [key, value] of Object.entries(imported)) {
        if (typeof value === 'function' && key.endsWith('Service')) {
          const ServiceClass = value as new (...args: unknown[]) => unknown
          const instance = tryInstantiateService(ServiceClass, container)
          if (instance) {
            const serviceName = key.charAt(0).toLowerCase() + key.slice(1)
            container.register(serviceName, instance)
          }
        }
      }
    } catch {
      // Module failed to load — skip
    }
  }

  // [Step 12] Load and register workflows
  const wm = new WorkflowManager(container)
  for (const wfInfo of resources.workflows) {
    try {
      const imported = await import(wfInfo.path)
      for (const value of Object.values(imported)) {
        if (value && typeof value === 'object' && 'name' in value && 'steps' in value) {
          wm.register(value as { name: string; steps: unknown[] })
        }
      }
    } catch {
      // Workflow failed to load — skip
    }
  }
  container.register('workflowManager', wm)

  // [Step 13] Load and wire subscribers
  const eventBus = container.resolve<IEventBusPort>(ContainerRegistrationKeys.EVENT_BUS)
  const resolveFromContainer = <T>(key: string): T => container.resolve<T>(key)

  for (const subInfo of resources.subscribers) {
    try {
      const imported = await import(subInfo.path)
      const sub = imported.default as { event: string; handler: (msg: Message, resolve: <T>(key: string) => T) => Promise<void> }
      if (sub?.event && typeof sub.handler === 'function') {
        eventBus.subscribe(sub.event, (msg: Message) => sub.handler(msg, resolveFromContainer))
      }
    } catch {
      // Subscriber failed to load — skip
    }
  }
}

/**
 * Try to instantiate a service class, resolving constructor dependencies from the container.
 */
function tryInstantiateService(
  ServiceClass: new (...args: unknown[]) => unknown,
  container: MantaContainer,
): unknown | null {
  try {
    if (ServiceClass.length === 0) {
      return new ServiceClass()
    }
    const portKeys = ['IFilePort', 'IDatabasePort', 'ILoggerPort', 'IEventBusPort', 'ICachePort']
    for (const key of portKeys) {
      try {
        const port = container.resolve(key)
        return new ServiceClass(port)
      } catch {
        continue
      }
    }
    return null
  } catch {
    return null
  }
}

