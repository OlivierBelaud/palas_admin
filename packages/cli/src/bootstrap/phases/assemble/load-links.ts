// Phase 3b: Load links — explicit + intra-module links, pivot tables, entity/link command generation.

import { generateEntityCommands, generateLinkCommands, getRegisteredLinks } from '@manta/core'
import type { AppRef, BootstrapContext } from '../../bootstrap-context'
import type { DmlEntityLike } from '../../bootstrap-helpers'
import { ensureEntityTables, generateMantaTypes, isDmlEntity } from '../../bootstrap-helpers'

export async function loadLinks(ctx: BootstrapContext, _appRef: AppRef): Promise<void> {
  const { logger, db, repoFactory, builder, resources, mode, cwd, doImport, generateLinkPgTable } = ctx
  const generatedTables = ctx.generatedTables
  const entityRegistry = ctx.entityRegistry as Map<string, DmlEntityLike>

  // [7a] Load links (src/links/*.ts) and generate pivot tables
  const loadedLinks: Array<Record<string, unknown>> = []
  ctx.loadedLinks = loadedLinks
  for (const linkInfo of resources.links) {
    try {
      const mod = await doImport(linkInfo.path)
      // biome-ignore lint/suspicious/noExplicitAny: link shape varies
      const link = (mod.default ?? mod) as any
      if (link?.tableName && link?.leftFk && link?.rightFk) {
        loadedLinks.push(link)
        const { tableName, table } = generateLinkPgTable(link)
        generatedTables.set(tableName, table)
        if (repoFactory.registerTable) repoFactory.registerTable(tableName, table)
        logger.info(`  Link: ${link.leftEntity} ↔ ${link.rightEntity} → ${tableName}`)
      }
    } catch (err) {
      logger.warn(`Failed to load link '${linkInfo.id}': ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // [7b] Load intra-module links (modules/*/links/*.ts)
  const moduleEntityMap = new Map<string, string>()
  for (const modInfo of resources.modules) {
    for (const entity of modInfo.entities) {
      moduleEntityMap.set(entity.name.toLowerCase(), modInfo.name)
    }
  }

  for (const modInfo of resources.modules) {
    for (const linkInfo of modInfo.intraLinks) {
      try {
        const mod = await doImport(linkInfo.path)
        // biome-ignore lint/suspicious/noExplicitAny: link shape varies
        const link = (mod.default ?? mod) as any
        if (link?.leftEntity && link?.rightEntity) {
          const leftName =
            typeof link.leftEntity === 'string'
              ? link.leftEntity
              : (link.leftEntity?.entityName ?? String(link.leftEntity))
          const rightName =
            typeof link.rightEntity === 'string'
              ? link.rightEntity
              : (link.rightEntity?.entityName ?? String(link.rightEntity))
          const leftMod = moduleEntityMap.get(leftName.toLowerCase())
          const rightMod = moduleEntityMap.get(rightName.toLowerCase())
          const isIntraModule = leftMod === rightMod && leftMod === modInfo.name

          if (isIntraModule && link.cardinality !== 'M:N') {
            link.isDirectFk = true
            loadedLinks.push(link)
            logger.info(
              `  Link: ${link.leftEntity} → ${link.rightEntity} (FK direct, ${link.cardinality}, module: ${modInfo.dirName})`,
            )
          } else {
            loadedLinks.push(link)
            if (link.tableName && link.leftFk && link.rightFk) {
              const { tableName, table } = generateLinkPgTable(link)
              generatedTables.set(tableName, table)
              if (repoFactory.registerTable) repoFactory.registerTable(tableName, table)
            }
            logger.info(
              `  Link: ${link.leftEntity} ↔ ${link.rightEntity} → ${link.tableName} (pivot, module: ${modInfo.dirName})`,
            )
          }
        }
      } catch (err) {
        logger.warn(
          `Failed to load intra-module link '${linkInfo.id}' in module '${modInfo.dirName}': ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // Also register links in the app for step.delete() cascade resolution
  const linkRegistry = loadedLinks

  // [7c] Auto-create entity tables + link tables in dev mode
  if (mode === 'dev') {
    const discoveredEntities: Array<{ name: string; schema: Record<string, unknown> }> = []
    for (const modInfo of resources.modules) {
      for (const entity of modInfo.entities) {
        try {
          const mod = await doImport(entity.modelPath)
          for (const value of Object.values(mod)) {
            if (isDmlEntity(value) && typeof value.getOptions === 'function') {
              const v = value as { isExternal?: () => boolean; name: string; schema: Record<string, unknown> }
              if (typeof v.isExternal === 'function' && v.isExternal()) continue
              discoveredEntities.push({ name: v.name, schema: v.schema })
            }
          }
        } catch {
          /* skip */
        }
      }
    }

    const discoveredLinks = getRegisteredLinks().map((l) => ({
      tableName: l.tableName,
      leftFk: l.leftFk,
      rightFk: l.rightFk,
      extraColumns: l.extraColumns,
    }))

    await ensureEntityTables(db.getPool(), discoveredEntities, discoveredLinks, logger)

    // [7d] Generate .manta/types.ts
    try {
      await generateMantaTypes(cwd, resources.modules, doImport, logger)
    } catch {
      // Silently skip — filesystem is likely read-only (Vercel, Lambda, etc.)
    }
  }

  // [7e] Register generated tables + links + entity registry in the app for step functions
  builder.registerInfra('__generatedTables', generatedTables)
  builder.registerInfra('__linkRegistry', linkRegistry)
  builder.registerInfra('__entityRegistry', entityRegistry)

  // [7f] Auto-generate entity commands from discovered modules
  const genEntityCmds = generateEntityCommands
  type EntityCommandDef = Awaited<ReturnType<typeof genEntityCmds>>[number]
  const entityCommandRegistry = new Map<string, EntityCommandDef>()
  ctx.entityCommandRegistry = entityCommandRegistry
  for (const [entityName, dmlEntity] of entityRegistry.entries()) {
    const ext = dmlEntity as { isExternal?: () => boolean }
    if (typeof ext.isExternal === 'function' && ext.isExternal()) continue
    const moduleName = (dmlEntity as { __module?: string }).__module
    if (!moduleName) continue
    try {
      const entityCmds = genEntityCmds(moduleName, dmlEntity as unknown as Parameters<typeof genEntityCmds>[1])
      for (const cmd of entityCmds) {
        entityCommandRegistry.set(cmd.name, cmd)
      }
      logger.info(`  Entity commands: ${moduleName}/${entityName} (${entityCmds.length} auto-generated)`)
    } catch (err) {
      logger.warn(
        `Failed to generate entity commands for '${moduleName}/${entityName}': ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // [7g] Auto-generate link/unlink commands from defineLink() definitions
  const genLinkCmds = generateLinkCommands
  let linkCmdCount = 0
  for (const link of loadedLinks) {
    if ((link as { isDirectFk?: boolean }).isDirectFk) continue
    try {
      const linkCmds = genLinkCmds(link as unknown as Parameters<typeof genLinkCmds>[0])
      for (const cmd of linkCmds) {
        entityCommandRegistry.set(cmd.name, cmd)
        linkCmdCount++
      }
    } catch (err) {
      logger.warn(`Failed to generate link commands: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (linkCmdCount > 0) {
    logger.info(`  Link commands: ${linkCmdCount} auto-generated (${linkCmdCount / 2} links)`)
  }

  builder.registerInfra('__entityCommandRegistry', entityCommandRegistry)
}
