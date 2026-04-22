// Phase 3c: Load resources — workflows, subscribers, jobs, agents, commands, queries, user defs.

import type { IEventBusPort, IWorkflowStorePort, Message } from '@manta/core'
import { createOrphanReaperJob, MantaError, QueryRegistry } from '@manta/core'
import type { AppRef, BootstrapContext } from '../../bootstrap-context'

export async function loadResources(ctx: BootstrapContext, appRef: AppRef): Promise<void> {
  const { logger, infraMap, builder, resources, doImport } = ctx

  // [8] Load workflows
  for (const wfInfo of resources.workflows) {
    try {
      const imported = await doImport(wfInfo.path)
      for (const [key, value] of Object.entries(imported)) {
        if (typeof value === 'function' && !key.startsWith('_')) {
          builder.registerWorkflow(key, value as (...args: unknown[]) => Promise<unknown>)
          logger.info(`  Workflow: ${key}`)
        }
      }
    } catch (err) {
      logger.warn(`Failed to load workflow '${wfInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // [9] Load subscribers
  for (const subInfo of resources.subscribers) {
    try {
      const imported = await doImport(subInfo.path)
      // biome-ignore lint/suspicious/noExplicitAny: subscriber shape varies
      const sub = imported.default as any
      if (sub?.event && typeof sub.handler === 'function') {
        const eventBus = infraMap.get('IEventBusPort') as IEventBusPort
        if (sub.__type === 'subscriber') {
          // defineSubscriber() — typed handler receives (event, { command, log })
          eventBus.subscribe(sub.event, async (msg: Message) => {
            try {
              await sub.handler(msg, { command: appRef.current!.commands, log: logger })
            } catch (err) {
              throw MantaError.wrap(err, `subscriber:${subInfo.id}`)
            }
          })
        } else {
          // Legacy — handler receives (msg, resolve)
          const resolveFromApp = <T>(key: string): T => appRef.current!.resolve<T>(key)
          eventBus.subscribe(sub.event, async (msg: Message) => {
            try {
              await sub.handler(msg, resolveFromApp)
            } catch (err) {
              throw MantaError.wrap(err, `subscriber:${subInfo.id}`)
            }
          })
        }
        logger.info(`  Subscriber: ${sub.event} → ${subInfo.id}`)
      }
    } catch (err) {
      logger.warn(`Failed to load subscriber '${subInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // [10] Load jobs + register framework-owned jobs (WP-F04 orphan reaper).
  let scheduler: {
    register: (name: string, schedule: string, handler: (...args: unknown[]) => unknown) => void
  } | null = null
  try {
    const s = infraMap.get('IJobSchedulerPort')
    if (s)
      scheduler = s as {
        register: (name: string, schedule: string, handler: (...args: unknown[]) => unknown) => void
      }
  } catch {
    logger.warn('IJobSchedulerPort not registered — skipping job loading')
  }

  if (scheduler && resources.jobs.length > 0) {
    for (const jobInfo of resources.jobs) {
      try {
        const imported = await doImport(jobInfo.path)
        const job = imported.default as {
          name: string
          schedule: string
          handler: (scope: { command: unknown; log: unknown }) => Promise<unknown>
        }
        if (job?.name && job.schedule && typeof job.handler === 'function') {
          scheduler.register(job.name, job.schedule, async () => {
            try {
              const result = await job.handler({ command: appRef.current!.commands, log: logger })
              return { status: 'success' as const, data: result, duration_ms: 0 }
            } catch (err) {
              throw MantaError.wrap(err, `job:${job.name}`)
            }
          })
          logger.info(`  Job: ${job.name} (${job.schedule})`)
        }
      } catch (err) {
        logger.warn(`Failed to load job '${jobInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // [10b] WP-F04 — register the framework-owned orphan reaper job when both
  // IJobSchedulerPort AND IWorkflowStorePort are wired. Silent no-op otherwise
  // (no scheduler = no reaper; no store = nothing to reap).
  if (scheduler) {
    const workflowStore = infraMap.get('IWorkflowStorePort') as IWorkflowStorePort | undefined
    if (workflowStore) {
      const reaper = createOrphanReaperJob({ store: workflowStore, logger })
      scheduler.register(reaper.name, reaper.schedule, reaper.handler)
      logger.info(`  Job: ${reaper.name} (${reaper.schedule}) [framework]`)
    }
  }

  // [11] Load agents (AI step definitions)
  // biome-ignore lint/suspicious/noExplicitAny: agent definition
  const agentRegistry = new Map<string, any>()
  ctx.agentRegistry = agentRegistry
  if (resources.agents && resources.agents.length > 0) {
    for (const agentInfo of resources.agents) {
      try {
        const imported = await doImport(agentInfo.path)
        // biome-ignore lint/suspicious/noExplicitAny: agent definition shape
        const agentDef = imported.default as any
        if (agentDef?.name) {
          agentRegistry.set(agentDef.name, agentDef)
          logger.info(`  Agent: ${agentDef.name}`)
        }
      } catch (err) {
        logger.warn(`Failed to load agent '${agentInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  builder.registerInfra('__agentRegistry', agentRegistry)

  // [12] Load commands — cross-module (src/commands/) + intra-module (modules/*/commands/)
  type CommandGraphDef = import('@manta/core').CommandGraphDefinition
  const commandGraphDefs = new Map<string, CommandGraphDef>()
  ctx.commandGraphDefs = commandGraphDefs
  const explicitCommandNames = new Set<string>()
  ctx.explicitCommandNames = explicitCommandNames

  for (const cmdInfo of resources.commands) {
    try {
      const imported = await doImport(cmdInfo.path)
      // biome-ignore lint/suspicious/noExplicitAny: command definition shape varies
      const def = imported.default as any

      // Detect defineCommandGraph() exports
      if (def?.__type === 'command-graph') {
        const context = cmdInfo.context ?? 'admin'
        commandGraphDefs.set(context, def as CommandGraphDef)
        logger.info(
          `  CommandGraph: ${context} (${def.access === '*' ? 'wildcard' : Object.keys(def.access).join(', ')})`,
        )
        continue
      }

      if (def?.name && def?.description && def?.input && typeof def?.workflow === 'function') {
        builder.registerCommand(def)
        explicitCommandNames.add(def.name)
        logger.info(`  Command: ${def.name}`)
      }
    } catch (err) {
      logger.warn(`Failed to load command '${cmdInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // [12b] Load intra-module commands
  const moduleScopedCommandNames: string[] = []
  ctx.moduleScopedCommandNames = moduleScopedCommandNames
  for (const modInfo of resources.modules) {
    for (const cmdInfo of modInfo.commands) {
      try {
        const imported = await doImport(cmdInfo.path)
        // biome-ignore lint/suspicious/noExplicitAny: command definition shape varies
        const def = imported.default as any
        const handlerFn = def?.workflow ?? def?.handler
        if (def?.name && def?.input && typeof handlerFn === 'function') {
          const normalizedDef = {
            __type: 'command' as const,
            name: def.name,
            description: def.description ?? '',
            input: def.input,
            __moduleScope: modInfo.name,
            workflow: handlerFn,
          }
          builder.registerCommand(normalizedDef)
          moduleScopedCommandNames.push(def.name)
          logger.info(`  Command: ${def.name} (module: ${modInfo.dirName})`)
        }
      } catch (err) {
        logger.warn(
          `Failed to load module command '${modInfo.dirName}/${cmdInfo.id}': ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // [12c] Load queries + query graphs
  const QR = QueryRegistry
  const queryRegistry = new QR()
  ctx.queryRegistry = queryRegistry
  const queryGraphDefs = new Map<string, { entities: '*' | string[] }>()
  ctx.queryGraphDefs = queryGraphDefs
  if (resources.queries.length > 0) {
    for (const queryInfo of resources.queries) {
      try {
        const imported = await doImport(queryInfo.path)
        // biome-ignore lint/suspicious/noExplicitAny: query definition shape varies
        const def = imported.default as any
        if (def?.__type === 'query-graph') {
          queryGraphDefs.set(queryInfo.context, def)
          const desc = def.access === '*' ? 'wildcard' : Object.keys(def.access).join(', ')
          logger.info(`  QueryGraph: ${queryInfo.context} (${desc})`)
        } else if (
          def?.name &&
          def?.description &&
          def?.input &&
          typeof def?.handler === 'function' &&
          def?.__type === 'query'
        ) {
          queryRegistry.register(def)
          logger.info(`  Query: ${def.name} (context: ${queryInfo.context})`)
        }
      } catch (err) {
        logger.warn(`Failed to load query '${queryInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // [12c.1] Load intra-module queries
  const queryExtensions: import('@manta/core').QueryGraphExtensionDefinition[] = []
  ctx.queryExtensions = queryExtensions
  for (const modInfo of resources.modules) {
    for (const queryInfo of modInfo.queries) {
      try {
        const imported = await doImport(queryInfo.path)
        // biome-ignore lint/suspicious/noExplicitAny: query definition shape varies
        const def = imported.default as any

        if (def?.__type === 'query-extension' && Array.isArray(def.owns) && typeof def.resolve === 'function') {
          ;(def as { __module?: string }).__module = modInfo.name
          queryExtensions.push(def as import('@manta/core').QueryGraphExtensionDefinition)
          logger.info(`  QueryGraph extension: ${modInfo.dirName}/${queryInfo.id} (owns: ${def.owns.join(', ')})`)
          continue
        }

        if (
          def?.name &&
          def?.description &&
          def?.input &&
          typeof def?.handler === 'function' &&
          def?.__type === 'query'
        ) {
          ;(def as { __moduleScope?: string }).__moduleScope = modInfo.name
          queryRegistry.register(def)
          logger.info(`  Query: ${def.name} (module: ${modInfo.dirName})`)
        }
      } catch (err) {
        logger.warn(
          `Failed to load module query '${modInfo.dirName}/${queryInfo.id}': ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }
  builder.registerInfra('queryRegistry', queryRegistry)

  // [12d] Load user definitions
  // biome-ignore lint/suspicious/noExplicitAny: user definition shape
  const userDefinitions: Array<{ contextName: string; def: any }> = []
  ctx.userDefinitions = userDefinitions
  if (resources.users.length > 0) {
    for (const userInfo of resources.users) {
      try {
        const imported = await doImport(userInfo.path)
        // biome-ignore lint/suspicious/noExplicitAny: user definition shape
        const def = imported.default as any
        if (def?.__type === 'user' && def?.contextName) {
          userDefinitions.push({ contextName: def.contextName, def })
          logger.info(`  User: ${def.contextName} (module: ${userInfo.moduleName})`)
        }
      } catch (err) {
        logger.warn(
          `Failed to load user definition '${userInfo.moduleName}': ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }
}
