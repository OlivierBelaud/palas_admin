// Phase 3a: Load modules — discover DML entities, generate tables, instantiate services.

import { InMemoryRepository, instantiateServiceDescriptor, isServiceDescriptor, toCamel } from '@manta/core'
import type { AppRef, BootstrapContext } from '../../bootstrap-context'
import type { DmlEntityLike } from '../../bootstrap-helpers'
import { entityToTableKey, isDmlEntity, tryInstantiateService } from '../../bootstrap-helpers'

export async function loadModules(ctx: BootstrapContext, _appRef: AppRef): Promise<void> {
  const { logger, db, infraMap, repoFactory, builder, resources, doImport, generatePgTableFromDml } = ctx

  // Auto-generated table map: entityName -> pgTable (built from DML entities, NOT hardcoded)
  const generatedTables = new Map<string, unknown>()
  ctx.generatedTables = generatedTables

  // Entity registry: entityName -> DmlEntity (for deferred service descriptor resolution)
  const entityRegistry = new Map<string, DmlEntityLike>()
  ctx.entityRegistry = entityRegistry

  // [7] Load modules — discover DML entities, generate tables, instantiate services
  for (const modInfo of resources.modules) {
    let entityCount = 0
    for (const entity of modInfo.entities) {
      try {
        // Import model.ts — must export a DmlEntity
        const modelMod = await doImport(entity.modelPath)

        // Find the DML entity in the model module exports
        let dmlEntity: DmlEntityLike | null = null
        for (const value of Object.values(modelMod)) {
          if (isDmlEntity(value) && typeof value.getOptions === 'function') {
            dmlEntity = value
            break
          }
          // Handle defineUserModel() exports — extract the .model DmlEntity
          if (
            typeof value === 'object' &&
            value !== null &&
            (value as Record<string, unknown>).__type === 'user' &&
            isDmlEntity((value as Record<string, unknown>).model) &&
            typeof ((value as Record<string, unknown>).model as DmlEntityLike).getOptions === 'function'
          ) {
            dmlEntity = (value as Record<string, unknown>).model as DmlEntityLike
            break
          }
        }
        if (!dmlEntity) continue

        // Tag entity with its module name + register in entity registry
        ;(dmlEntity as DmlEntityLike & { __module?: string }).__module = modInfo.name
        entityRegistry.set(dmlEntity.name, dmlEntity)

        const entityName = dmlEntity.name

        // External entity — skip table generation, migrations, and auto-service.
        const entityOptions =
          (dmlEntity as DmlEntityLike & { getOptions?: () => Record<string, unknown> }).getOptions?.() ?? {}
        if ((entityOptions as { external?: boolean }).external === true) {
          entityCount++
          logger.info(`  Module: ${modInfo.dirName}/${entity.name} → ${entityName} (external — no table)`)
          continue
        }

        // Import service.ts if it exists
        let serviceDescriptor: ReturnType<typeof isServiceDescriptor> extends true ? unknown : unknown = null
        let ServiceClass: (new (...args: unknown[]) => unknown) | null = null
        if (entity.servicePath) {
          try {
            const serviceMod = await doImport(entity.servicePath)
            const defaultExport = serviceMod.default
            if (isServiceDescriptor(defaultExport)) {
              // Detect empty service
              try {
                const fakeRepo = new Proxy({}, { get: () => async () => [] })
                const fakeLog = new Proxy({}, { get: () => () => {} })
                const methods = (defaultExport as { factory: (ctx: unknown) => Record<string, unknown> }).factory({
                  db: fakeRepo,
                  log: fakeLog,
                })
                if (Object.keys(methods).length === 0) {
                  logger.warn(
                    `Module "${modInfo.dirName}/${entity.name}": service.ts has no custom methods — delete it.\n` +
                      `    CRUD (create, update, delete, list, retrieve) is auto-generated from the model.`,
                  )
                }
              } catch {
                // Factory introspection failed — not critical
              }
              serviceDescriptor = defaultExport
            } else {
              // Legacy: class-based service
              for (const [key, value] of Object.entries(serviceMod)) {
                if (typeof value === 'function' && key.endsWith('Service')) {
                  ServiceClass = value as new (...args: unknown[]) => unknown
                  break
                }
              }
            }
          } catch {
            // service.ts failed to import — continue with model-only (CRUD auto-generated)
          }
        }

        // Generate table from DML entity
        if (db) {
          const { tableName, table } = generatePgTableFromDml(
            dmlEntity as unknown as Parameters<typeof generatePgTableFromDml>[0],
          )
          generatedTables.set(tableName, table)
          generatedTables.set(entityToTableKey(entityName), table)
        }

        // Resolve deferred entity on service descriptor
        if (serviceDescriptor && isServiceDescriptor(serviceDescriptor)) {
          const desc = serviceDescriptor as {
            _entityName?: string
            entity: unknown
            $modelObjects: Record<string, unknown>
          }
          if (desc._entityName && !desc.entity) {
            const resolved = entityRegistry.get(desc._entityName)
            if (resolved) {
              desc.entity = resolved
              desc.$modelObjects = { [resolved.name]: resolved }
            } else {
              desc.entity = dmlEntity
              desc.$modelObjects = { [dmlEntity.name]: dmlEntity }
            }
          }
        }

        // Instantiate service
        let instance: Record<string, unknown> | null = null

        if (serviceDescriptor && isServiceDescriptor(serviceDescriptor)) {
          const tableKey = entityToTableKey(entityName)
          const table = generatedTables.get(tableKey)
          if (table) repoFactory.registerTable!(tableKey, table)
          const repo = repoFactory.createRepository(tableKey)
          instance = instantiateServiceDescriptor(serviceDescriptor, repo, undefined, logger)
        } else if (ServiceClass) {
          instance = tryInstantiateService(ServiceClass, infraMap, repoFactory) as Record<string, unknown> | null
        } else {
          const tableKey = entityToTableKey(entityName)
          const table = generatedTables.get(tableKey)
          if (table) repoFactory.registerTable!(tableKey, table)
          try {
            const repo = repoFactory.createRepository(tableKey)
            instance = instantiateServiceDescriptor(
              {
                __type: 'service',
                entity: dmlEntity,
                factory: () => ({}),
                $modelObjects: { [entityName]: dmlEntity },
              } as unknown as Parameters<typeof instantiateServiceDescriptor>[0],
              repo,
              undefined,
              logger,
            )
          } catch {
            const repo = new InMemoryRepository(entityName.toLowerCase())
            instance = instantiateServiceDescriptor(
              {
                __type: 'service',
                entity: dmlEntity,
                factory: () => ({}),
                $modelObjects: { [entityName]: dmlEntity },
              } as unknown as Parameters<typeof instantiateServiceDescriptor>[0],
              repo,
              undefined,
              logger,
            )
          }
        }

        if (instance) {
          const camelEntity = toCamel(entityName)
          builder.registerModule(camelEntity, instance)
          if (entityCount === 0) {
            builder.registerModule(modInfo.name, instance)
            builder.registerModule(`${modInfo.name}Service`, instance)
          }
          entityCount++
          logger.info(`  Module: ${modInfo.dirName}/${entity.name} → ${camelEntity}`)
        }
      } catch (err) {
        logger.warn(
          `Failed to load entity '${modInfo.dirName}/${entity.name}': ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }
}
