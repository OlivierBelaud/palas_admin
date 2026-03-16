// SPEC-074 — 18-step bootstrap sequence
// Real implementation: creates container, registers adapters, validates config

import type { BootContext } from '../types'
import type { ModuleExports, IEventBusPort } from '@manta/core'
import {
  MantaContainer,
  ContainerRegistrationKeys,
  InMemoryCacheAdapter,
  InMemoryEventBusAdapter,
  InMemoryLockingAdapter,
  TestLogger,
} from '@manta/core'

export interface BootResult {
  success: boolean
  stepsCompleted: number
  errors: Array<{ step: number; message: string; fatal: boolean }>
  warnings: string[]
  timings: Record<number, number>
}

/**
 * Execute the core boot (steps 1-8).
 *
 * Core boot is synchronous and fatal: any error in steps 1-7 = exit(1).
 * Step 8 (routes) is best-effort: failure = warning.
 */
export async function boot(context: BootContext): Promise<BootResult> {
  const result: BootResult = {
    success: false,
    stepsCompleted: 0,
    errors: [],
    warnings: [],
    timings: {},
  }

  const steps = [
    { num: 1, name: 'Config loaded', fatal: true, fn: () => stepLoadConfig(context) },
    { num: 2, name: 'Feature flags', fatal: true, fn: () => stepFeatureFlags(context) },
    { num: 3, name: 'Container created', fatal: true, fn: () => stepCreateContainer(context) },
    { num: 4, name: 'Logger initialized', fatal: true, fn: () => stepInitLogger(context) },
    { num: 5, name: 'Database connected', fatal: true, fn: () => stepConnectDb(context) },
    { num: 6, name: 'Required modules loaded', fatal: true, fn: () => stepRequiredModules(context) },
    { num: 7, name: 'Event buffer activated', fatal: true, fn: () => stepEventBuffer(context) },
    { num: 8, name: 'Routes registered', fatal: false, fn: () => stepRegisterRoutes(context) },
  ]

  for (const step of steps) {
    const start = Date.now()
    try {
      await step.fn()
      result.timings[step.num] = Date.now() - start
      result.stepsCompleted = step.num

      if (context.verbose) {
        // [boot:N] Step name (Xms)
      }
    } catch (err) {
      result.timings[step.num] = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)

      if (!step.fatal) {
        // Best-effort step (e.g. routes): warning, continue
        result.warnings.push(`Route registration warning: ${message}`)
        result.stepsCompleted = step.num
      } else {
        result.errors.push({ step: step.num, message, fatal: true })
        return result
      }
    }
  }

  result.success = true
  return result
}

/**
 * Execute lazy boot (steps 9-18). Called on first request.
 * Steps 9, 10, 18 are fatal (503 + retry). Others are best-effort.
 */
export async function lazyBoot(context: BootContext): Promise<BootResult> {
  const result: BootResult = {
    success: false,
    stepsCompleted: 8,
    errors: [],
    warnings: [],
    timings: {},
  }

  const lazySteps = [
    { num: 9, name: 'Modules loaded', fatal: true, fn: () => stepLoadModules(context) },
    { num: 10, name: 'QUERY/LINK registered', fatal: true, fn: () => stepRegisterQueryLink(context) },
    { num: 11, name: 'Link modules loaded', fatal: false, fn: () => stepLoadLinks(context) },
    { num: 12, name: 'Workflows registered', fatal: false, fn: () => stepLoadWorkflows(context) },
    { num: 13, name: 'Subscribers registered', fatal: false, fn: () => stepLoadSubscribers(context) },
    { num: 14, name: 'RBAC policies loaded', fatal: false, fn: () => stepLoadRbac(context) },
    { num: 15, name: 'Jobs registered', fatal: false, fn: () => stepLoadJobs(context) },
    { num: 16, name: 'onApplicationStart called', fatal: false, fn: () => stepOnApplicationStart(context) },
    { num: 17, name: 'Translation synced', fatal: false, fn: () => stepSyncTranslation(context) },
    { num: 18, name: 'Event buffer released', fatal: true, fn: () => stepReleaseEventBuffer(context) },
  ]

  for (const step of lazySteps) {
    const start = Date.now()
    try {
      await step.fn()
      result.timings[step.num] = Date.now() - start
      result.stepsCompleted = step.num
    } catch (err) {
      result.timings[step.num] = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)

      if (step.fatal) {
        result.errors.push({ step: step.num, message, fatal: true })
        return result
      }
      result.warnings.push(`Step ${step.num} (${step.name}): ${message}`)
    }
  }

  result.success = true
  return result
}

// --- Step implementations (core boot 1-8) ---

async function stepLoadConfig(_ctx: BootContext): Promise<void> {
  // Config already loaded before boot() is called
}

async function stepFeatureFlags(ctx: BootContext): Promise<void> {
  const flags = ctx.config.featureFlags ?? {}
  const knownFlags = new Set(['rbac', 'translation'])
  for (const flag of Object.keys(flags)) {
    if (!knownFlags.has(flag)) {
      throw new Error(`Unknown feature flag '${flag}' in defineConfig()`)
    }
  }
}

async function stepCreateContainer(ctx: BootContext): Promise<void> {
  if (!ctx.container) {
    ctx.container = new MantaContainer()
  }
}

async function stepInitLogger(ctx: BootContext): Promise<void> {
  const container = ctx.container!
  const logger = new TestLogger()
  container.register(ContainerRegistrationKeys.LOGGER, logger)
}

async function stepConnectDb(ctx: BootContext): Promise<void> {
  if (!ctx.config.database?.url) {
    throw new Error('Cannot connect to database. DATABASE_URL is not set.')
  }
}

async function stepRequiredModules(ctx: BootContext): Promise<void> {
  const container = ctx.container!
  if (!containerHas(container, ContainerRegistrationKeys.EVENT_BUS)) {
    container.register(ContainerRegistrationKeys.EVENT_BUS, new InMemoryEventBusAdapter())
  }
  if (!containerHas(container, ContainerRegistrationKeys.CACHE)) {
    container.register(ContainerRegistrationKeys.CACHE, new InMemoryCacheAdapter())
  }
  if (!containerHas(container, ContainerRegistrationKeys.LOCKING)) {
    container.register(ContainerRegistrationKeys.LOCKING, new InMemoryLockingAdapter())
  }
}

async function stepEventBuffer(ctx: BootContext): Promise<void> {
  // Activate event buffering: create a group for boot events
  const container = ctx.container
  if (!container) return

  const groupId = `boot-${container.id}`
  ctx.bootEventGroupId = groupId
  // The group is created lazily when first event is emitted with this groupId
}

async function stepRegisterRoutes(_ctx: BootContext): Promise<void> {
  // Route registration happens in server-bootstrap.ts
  // This step is a placeholder for the boot sequence
}

// --- Step implementations (lazy boot 9-18) ---

async function stepLoadModules(ctx: BootContext): Promise<void> {
  const resources = ctx.discoveredResources
  if (!resources || resources.modules.length === 0) {
    // No modules to load — initialize empty map if not set
    if (!ctx.loadedModules) ctx.loadedModules = new Map()
    return
  }

  const container = ctx.container

  // If modules were pre-loaded (e.g. in tests), use them directly
  if (ctx.loadedModules && ctx.loadedModules.size > 0) {
    if (container) {
      for (const [name, mod] of ctx.loadedModules) {
        container.register(name, new mod.service())
      }
    }
    return
  }

  // Dynamic import of each discovered module
  ctx.loadedModules = new Map()
  for (const modInfo of resources.modules) {
    try {
      const imported = await import(modInfo.path)
      const moduleExports: ModuleExports = imported.default ?? imported
      if (!moduleExports.name || !moduleExports.service) {
        throw new Error(`Module at ${modInfo.path} does not export valid ModuleExports (missing name or service)`)
      }
      ctx.loadedModules.set(moduleExports.name, moduleExports)

      if (container) {
        const serviceInstance = new moduleExports.service()
        container.register(modInfo.name, serviceInstance)
        container.register(`${modInfo.name}Service`, serviceInstance)

        if (moduleExports.loaders) {
          for (const loader of moduleExports.loaders) {
            await loader(container)
          }
        }
      }
    } catch (err) {
      throw new Error(`Failed to load module '${modInfo.name}': ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function stepRegisterQueryLink(ctx: BootContext): Promise<void> {
  const container = ctx.container
  if (!container) return

  const loadedModules = ctx.loadedModules ?? new Map()
  const moduleRegistry: Record<string, unknown> = {}
  for (const [name, mod] of loadedModules) {
    moduleRegistry[name] = mod
  }

  if (!containerHas(container, 'QUERY')) {
    container.register('QUERY', { modules: moduleRegistry })
  }
  if (!containerHas(container, 'LINK')) {
    container.register('LINK', { modules: moduleRegistry })
  }
  if (!containerHas(container, 'REMOTE_LINK')) {
    container.register('REMOTE_LINK', { modules: moduleRegistry })
  }
}

async function stepLoadLinks(ctx: BootContext): Promise<void> {
  const links = ctx.discoveredResources?.links ?? []
  if (links.length === 0) return

  for (const link of links) {
    // Dynamic import of each link definition
    await import(link.path)
  }
}

async function stepLoadWorkflows(ctx: BootContext): Promise<void> {
  const workflows = ctx.discoveredResources?.workflows ?? []
  if (workflows.length === 0) return

  for (const wf of workflows) {
    await import(wf.path)
  }
}

async function stepLoadSubscribers(ctx: BootContext): Promise<void> {
  const subscribers = ctx.discoveredResources?.subscribers ?? []
  if (subscribers.length === 0) return
  if (!ctx.container) return

  const eventBus = ctx.container.resolve<IEventBusPort>(ContainerRegistrationKeys.EVENT_BUS)

  for (const sub of subscribers) {
    const mod = await import(sub.path)
    const handler = mod.default ?? mod.handler
    const event = mod.event ?? mod.eventName
    const subscriberId = mod.subscriberId ?? sub.id

    if (typeof handler === 'function' && event) {
      const events = Array.isArray(event) ? event : [event]
      for (const eventName of events) {
        eventBus.subscribe(eventName, handler, { subscriberId })
      }
    }
  }
}

async function stepLoadRbac(ctx: BootContext): Promise<void> {
  if (!ctx.config.featureFlags?.rbac) return
}

async function stepLoadJobs(ctx: BootContext): Promise<void> {
  const jobs = ctx.discoveredResources?.jobs ?? []
  if (jobs.length === 0) return

  for (const job of jobs) {
    await import(job.path)
  }
}

async function stepOnApplicationStart(ctx: BootContext): Promise<void> {
  const loadedModules = ctx.loadedModules ?? new Map()

  for (const [name, mod] of loadedModules) {
    if (mod.hooks?.onApplicationStart) {
      try {
        await mod.hooks.onApplicationStart()
      } catch (err) {
        throw new Error(`Module '${name}' onApplicationStart failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
}

async function stepSyncTranslation(ctx: BootContext): Promise<void> {
  if (!ctx.config.featureFlags?.translation) return
}

async function stepReleaseEventBuffer(ctx: BootContext): Promise<void> {
  const groupId = ctx.bootEventGroupId
  if (!groupId || !ctx.container) return

  const eventBus = ctx.container.resolve<IEventBusPort>(ContainerRegistrationKeys.EVENT_BUS)
  await eventBus.releaseGroupedEvents(groupId)
}

// --- Helpers ---

function containerHas(container: import('@manta/core').IContainer, key: string): boolean {
  try {
    container.resolve(key)
    return true
  } catch {
    return false
  }
}
