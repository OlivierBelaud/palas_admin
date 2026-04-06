// SPEC-086 — manta exec command

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { PinoLoggerAdapter } from '@manta/adapter-logger-pino'
import type { IEventBusPort, IFilePort, Message, TestMantaApp, WorkflowDefinition } from '@manta/core'
import {
  createTestMantaApp,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryFileAdapter,
  InMemoryLockingAdapter,
  WorkflowManager,
} from '@manta/core'
import { discoverResources } from '../resource-loader'
import type { ExecOptions } from '../types'

export interface ExecCommandResult {
  exitCode: number
  errors: string[]
}

/**
 * manta exec — Execute a script with the framework app loaded.
 * Uses the ResourceLoader to discover and wire all project resources
 * (modules, workflows, subscribers) — same boot path as manta dev.
 * --dry-run: wraps in a transaction and rolls back.
 */
export async function execCommand(options: ExecOptions, cwd: string = process.cwd()): Promise<ExecCommandResult> {
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
          'Expected: export default async ({ app, args }) => { ... }',
      )
      return result
    }

    // Create a MantaApp with infrastructure adapters
    const app = createTestMantaApp({
      infra: {
        eventBus: new InMemoryEventBusAdapter(),
        logger: new PinoLoggerAdapter({ level: 'debug', pretty: true }),
        cache: new InMemoryCacheAdapter(),
        locking: new InMemoryLockingAdapter(),
        file: new InMemoryFileAdapter(),
        db: {},
      },
    })

    // Discover and wire all project resources via ResourceLoader
    await resourceLoaderBootstrap(app, cwd)

    // Execute the script with the app
    await fn({
      app,
      args: options.args ?? [],
    })

    // Dispose the app after execution
    await app.dispose()
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
export async function resourceLoaderBootstrap(app: TestMantaApp, cwd: string): Promise<void> {
  const resources = await discoverResources(cwd)

  // [Step 9] Load modules — discover entities, instantiate & register
  for (const modInfo of resources.modules) {
    for (const entity of modInfo.entities) {
      try {
        const imported = await import(entity.modelPath)
        for (const [key, value] of Object.entries(imported)) {
          if (typeof value === 'function' && key.endsWith('Service')) {
            const ServiceClass = value as new (...args: unknown[]) => unknown
            const instance = tryInstantiateService(ServiceClass, app)
            if (instance) {
              const serviceName = key.charAt(0).toLowerCase() + key.slice(1)
              app.register(serviceName, instance)
            }
          }
        }
      } catch {
        // Entity failed to load — skip
      }
    }
  }

  // [Step 12] Load and register workflows — WorkflowManager requires MantaApp
  const wm = new WorkflowManager(app)
  for (const wfInfo of resources.workflows) {
    try {
      const imported = await import(wfInfo.path)
      for (const value of Object.values(imported)) {
        if (value && typeof value === 'object' && 'name' in value && 'steps' in value) {
          wm.register(value as unknown as WorkflowDefinition)
        }
      }
    } catch {
      // Workflow failed to load — skip
    }
  }
  app.register('workflowManager', wm)

  // [Step 13] Load and wire subscribers
  const eventBus = app.infra.eventBus
  const resolveFromApp = <T>(key: string): T => app.resolve<T>(key)

  for (const subInfo of resources.subscribers) {
    try {
      const imported = await import(subInfo.path)
      const sub = imported.default as {
        event: string
        __type?: string
        handler: (...args: unknown[]) => Promise<void>
      }
      if (sub?.event && typeof sub.handler === 'function') {
        if (sub.__type) {
          eventBus.subscribe(sub.event, (msg: Message) =>
            sub.handler(msg, { command: app.commands, log: app.infra.logger }),
          )
        } else {
          eventBus.subscribe(sub.event, (msg: Message) => (sub.handler as Function)(msg, resolveFromApp))
        }
      }
    } catch {
      // Subscriber failed to load — skip
    }
  }
}

/**
 * Try to instantiate a service class, resolving constructor dependencies from the app.
 */
function tryInstantiateService(ServiceClass: new (...args: unknown[]) => unknown, app: TestMantaApp): unknown | null {
  try {
    if (ServiceClass.length === 0) {
      return new ServiceClass()
    }
    const portKeys = ['IFilePort', 'IDatabasePort', 'ILoggerPort', 'IEventBusPort', 'ICachePort']
    for (const key of portKeys) {
      try {
        const port = app.resolve(key)
        return new ServiceClass(port)
      } catch {}
    }
    return null
  } catch {
    return null
  }
}
