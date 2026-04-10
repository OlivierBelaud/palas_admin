// [13d] Load contexts (src/contexts/*.ts).

import { ContextRegistry, isCommandAllowed } from '@manta/core'
import type { AppRef, BootstrapContext } from '../../../bootstrap-context'

export async function buildContextRegistry(ctx: BootstrapContext, _appRef: AppRef): Promise<ContextRegistry> {
  const {
    logger,
    resources,
    doImport,
    entityRegistry,
    entityCommandRegistry,
    explicitCommandNames,
    commandGraphDefs,
    userDefinitions,
    moduleScopedCommandNames,
    cmdRegistry,
  } = ctx

  // [13d] Load contexts (src/contexts/*.ts)
  const contextRegistry = new ContextRegistry()
  const moduleNames = [
    ...resources.modules.map((m: any) => m.name),
    ...Array.from(entityRegistry.keys()).map((k) => k.toLowerCase()),
  ]
  const commandNames = cmdRegistry ? cmdRegistry.list().map((e: any) => e.name) : []

  // Helper: resolve entity commands visible for a context based on its command graph
  const isEntityCmdAllowed = isCommandAllowed
  const resolveEntityCommandsForContext = (ctxName: string): string[] => {
    const graphDef = commandGraphDefs.get(ctxName)
    if (!graphDef) return []

    const visibleEntityCmds: string[] = []
    for (const [cmdName, entityCmd] of entityCommandRegistry.entries()) {
      if (explicitCommandNames.has(cmdName)) continue
      if (isEntityCmdAllowed(graphDef as any, (entityCmd as any).__module, (entityCmd as any).__operation)) {
        visibleEntityCmds.push(cmdName)
      }
    }
    return visibleEntityCmds
  }

  if (resources.contexts.length > 0) {
    // V1 path: explicit defineContext files
    for (const ctxInfo of resources.contexts) {
      try {
        const imported = await doImport(ctxInfo.path)
        // biome-ignore lint/suspicious/noExplicitAny: context definition shape varies
        const def = imported.default as any
        if (def?.name && def?.basePath && def?.actors) {
          const entityCmds = resolveEntityCommandsForContext(def.name)
          if (entityCmds.length > 0) {
            def.commands = [...(def.commands ?? []), ...entityCmds]
          }
          contextRegistry.register(def, moduleNames, [...commandNames, ...entityCmds])
          logger.info(
            `  Context: ${def.name} (${def.basePath}) [V1 explicit]${entityCmds.length > 0 ? ` +${entityCmds.length} entity commands` : ''}`,
          )
        }
      } catch (err) {
        logger.warn(`Failed to load context '${ctxInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } else if (
    resources.users.length > 0 ||
    resources.queries.length > 0 ||
    resources.commands.some((c: any) => c.context)
  ) {
    // V2 path: derive contexts from filesystem structure
    const derivedContexts = new Set<string>()

    for (const cmd of resources.commands) {
      if (cmd.context) derivedContexts.add(cmd.context)
    }
    for (const q of resources.queries) {
      derivedContexts.add(q.context)
    }
    for (const u of userDefinitions) {
      derivedContexts.add(u.contextName)
    }

    const commandGraphIds = new Set<string>()
    for (const cmd of resources.commands) {
      if (cmd.context && commandGraphDefs.has(cmd.context) && cmd.id === 'graph') {
        commandGraphIds.add(`${cmd.context}:${cmd.id}`)
      }
    }

    const kebabToCamel = (s: string) => s.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase())

    for (const ctxName of derivedContexts) {
      const ctxCommands = resources.commands
        .filter((c: any) => c.context === ctxName && !commandGraphIds.has(`${c.context}:${c.id}`))
        .map((c: any) => kebabToCamel(c.id))
      const flatCommands = resources.commands.filter((c: any) => !c.context).map((c: any) => kebabToCamel(c.id))
      const entityCmds = resolveEntityCommandsForContext(ctxName)
      const allCtxCommands = [...ctxCommands, ...flatCommands, ...entityCmds, ...moduleScopedCommandNames]

      const hasUser = userDefinitions.some((u: any) => u.contextName === ctxName)
      const actors = hasUser ? [ctxName] : []

      contextRegistry.register(
        {
          name: ctxName,
          basePath: `/api/${ctxName}`,
          actors,
          modules: Object.fromEntries(moduleNames.map((m: string) => [m, { expose: '*' }])),
          commands: allCtxCommands,
        },
        moduleNames,
        [...commandNames, ...entityCmds],
      )
      logger.info(
        `  Context: ${ctxName} (/api/${ctxName}) [V2 filesystem-derived]${entityCmds.length > 0 ? ` +${entityCmds.length} entity commands` : ''}`,
      )
    }
  } else {
    contextRegistry.registerDefault(moduleNames, commandNames)
    logger.info('  Context: admin (implicit, /api/admin)')
  }

  return contextRegistry
}
