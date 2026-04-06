// Step API — direct, module-aware, typed.
//
// step.product.create({ title: 'Widget' }, ctx)   → auto-compensated
// step.product.activate(id, ctx)                   → auto-compensation via SnapshotRepository
// step.product.delete(id, ctx)                     → smart delete: cascade + dismiss based on link types
// step.product.link.inventoryItem(pId, iId, ctx)   → link via pivot, auto-compensated
// step.emit('product.created', data, ctx)           → fire-and-forget event
//
// `step` is a Proxy. When you access step.product, it returns a module helper
// that resolves the service from ctx.app at call time.

import { and, eq, isNull } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { MantaError } from '../errors/manta-error'
import type { ResolvedLink } from '../link'
import { getRegisteredLinks } from '../link'
import type { SnapshotRepository } from '../service/snapshot-repository'
import { workflowContextStorage } from './manager'
import type { StepContext, StepDefinition, StepHandlerContext, StepResolveContext, WorkflowContext } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pluralize(name: string): string {
  if (name.endsWith('s') || name.endsWith('x') || name.endsWith('ch') || name.endsWith('sh')) return name + 'es'
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) return name.slice(0, -1) + 'ies'
  return name + 's'
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Resolve registered links from the app context (preferred) or global registry (fallback).
 * The app's __linkRegistry is set by the bootstrap and avoids module instance mismatch.
 */
function resolveLinks(ctx: StepContext): readonly ResolvedLink[] {
  try {
    const registry = ctx.app.resolve<ResolvedLink[]>('__linkRegistry')
    if (registry && registry.length > 0) return registry
  } catch {
    /* not registered */
  }
  return getRegisteredLinks()
}

/**
 * Get the Drizzle db instance from the step context.
 */
// biome-ignore lint/suspicious/noExplicitAny: Drizzle db is dynamically typed across adapters
function getDb(ctx: StepContext): any {
  return (ctx.app.infra as any).db
}

/**
 * Resolve a generated Drizzle pgTable by name.
 * Tables are generated at boot from DML entities and links, registered as __generatedTables.
 */
function getLinkTable(ctx: StepContext, tableName: string): PgTable {
  try {
    const tables = ctx.app.resolve<Map<string, unknown>>('__generatedTables')
    const table = tables.get(tableName)
    if (table) return table as PgTable
  } catch {
    /* not registered */
  }
  throw new MantaError(
    'INVALID_STATE',
    `Link table "${tableName}" not found. Ensure the link is defined via defineLink() in src/links/ and that migrations are up to date (manta db:generate && manta db:migrate).`,
  )
}

/**
 * Get a column from a Drizzle table by name.
 */
// biome-ignore lint/suspicious/noExplicitAny: Drizzle column access is dynamic
function getColumn(table: PgTable, columnName: string): any {
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle table internals
  return (table as any)[columnName]
}

function resolveService(ctx: StepContext, entity: string): Record<string, Function> {
  const moduleName = entity.toLowerCase()
  const modules = ctx.app.modules as Record<string, unknown>

  // Try by module name first (catalog, inventory, etc.)
  const direct = modules[moduleName] ?? modules[entity]
  if (direct) return direct as Record<string, Function>

  // Try by entity name — search all modules for one whose __entity.name matches
  for (const [_key, svc] of Object.entries(modules)) {
    const s = svc as Record<string, unknown>
    if (s?.__entity && (s.__entity as { name: string }).name === entity) {
      return s as Record<string, Function>
    }
  }

  // Fallback: resolve from app registry
  try {
    return ctx.app.resolve<Record<string, Function>>(`${moduleName}ModuleService`)
  } catch {
    const available = Object.keys(ctx.app.modules as Record<string, unknown>).join(', ')
    throw new MantaError(
      'UNKNOWN_MODULES',
      `Service for "${entity}" not found. Available modules: [${available}]. Check that the module is in src/modules/ and exports a defineService().`,
    )
  }
}

/**
 * Run a step within the workflow context: checkpoint, execute, register compensation.
 */
async function runStep<T>(
  name: string,
  ctx: StepContext,
  handler: () => Promise<T>,
  compensate?: (output: T) => Promise<void>,
): Promise<T> {
  const wfCtx: WorkflowContext | null = workflowContextStorage.getStore() ?? ctx.__wfCtx ?? null

  if (!wfCtx) {
    return handler()
  }

  const count = (wfCtx.stepCounter.get(name) ?? 0) + 1
  wfCtx.stepCounter.set(name, count)
  const stepKey = count === 1 ? name : `${name}-${count}`

  if (wfCtx.checkpoints.has(stepKey)) {
    const cached = wfCtx.checkpoints.get(stepKey)
    if (compensate) {
      wfCtx.completedSteps.push({
        name: stepKey,
        output: cached,
        compensate: async (out) => compensate(out as T),
      })
    }
    return cached as T
  }

  const output = await handler()

  if (compensate) {
    wfCtx.completedSteps.push({
      name: stepKey,
      output,
      compensate: async (out) => compensate(out as T),
    })
  } else {
    wfCtx.completedSteps.push({ name: stepKey, output })
  }

  wfCtx.checkpoints.set(stepKey, output)
  if (wfCtx.saveCheckpoint) await wfCtx.saveCheckpoint(stepKey, output)
  return output
}

// ---------------------------------------------------------------------------
// Auto-resolve: find the last created entity ID from workflow context
// ---------------------------------------------------------------------------

function findLastCreatedId(ctx: StepContext, entityName: string): string | null {
  const wfCtx: WorkflowContext | null = workflowContextStorage.getStore() ?? ctx.__wfCtx ?? null
  if (!wfCtx) return null

  const stepName = `create-${entityName.toLowerCase()}`
  // Scan completed steps in reverse to find the most recent create for this entity
  for (let i = wfCtx.completedSteps.length - 1; i >= 0; i--) {
    const step = wfCtx.completedSteps[i]
    if (step.name.startsWith(stepName)) {
      const output = step.output as Record<string, unknown> | undefined
      if (output?.id) return output.id as string
    }
  }
  // Also check checkpoints (for crash recovery)
  for (const [key, value] of wfCtx.checkpoints) {
    if (key.startsWith(stepName)) {
      const output = value as Record<string, unknown> | undefined
      if (output?.id) return output.id as string
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Cascade delete helpers
// ---------------------------------------------------------------------------

interface CascadeDeleteResult {
  entityId: string
  entityName: string
  deletedLinks: Array<{ tableName: string; linkId: string }>
  deletedChildren: Array<{ entity: string; id: string }>
}

function findCascadeLinks(ctx: StepContext, entityModule: string, entityName: string): ResolvedLink[] {
  return resolveLinks(ctx).filter(
    (link) => (link.leftModule === entityModule || link.leftEntity === entityName) && link.cascadeLeft === true,
  )
}

// ---------------------------------------------------------------------------
// Step implementations
// ---------------------------------------------------------------------------

async function stepCreate(
  entity: string,
  data: Record<string, unknown>,
  ctx: StepContext,
): Promise<Record<string, unknown>> {
  const suffix = capitalize(pluralize(entity))
  return runStep(
    `create-${entity.toLowerCase()}`,
    ctx,
    async () => {
      const service = resolveService(ctx, entity)
      const method = service[`create${suffix}`]
      if (!method) throw new MantaError('NOT_FOUND', `Service for "${entity}" has no create${suffix} method`)
      const result = (await method.call(service, data)) as Record<string, unknown>
      // Tag with entity name so step.link() can auto-resolve
      Object.defineProperty(result, ENTITY_TAG, { value: entity, enumerable: false })
      return result
    },
    async (output) => {
      const service = resolveService(ctx, entity)
      const deleteMethod = service[`delete${suffix}`]
      if (deleteMethod && output.id) await deleteMethod.call(service, [output.id as string])
    },
  )
}

async function stepUpdate(
  entity: string,
  id: string,
  data: Record<string, unknown>,
  ctx: StepContext,
): Promise<Record<string, unknown>> {
  const suffix = capitalize(pluralize(entity))
  const entityCap = capitalize(entity)

  let previousData: Record<string, unknown> | undefined
  try {
    const service = resolveService(ctx, entity)
    const retrieveMethod = service[`retrieve${entityCap}`]
    if (retrieveMethod) previousData = (await retrieveMethod.call(service, id)) as Record<string, unknown>
  } catch {
    /* best effort */
  }

  return runStep(
    `update-${entity.toLowerCase()}`,
    ctx,
    async () => {
      const service = resolveService(ctx, entity)
      const method = service[`update${suffix}`]
      if (!method) throw new MantaError('NOT_FOUND', `Service for "${entity}" has no update${suffix} method`)
      const result = (await method.call(service, { id, ...data })) as Record<string, unknown>
      Object.defineProperty(result, ENTITY_TAG, { value: entity, enumerable: false })
      return result
    },
    previousData
      ? async () => {
          const service = resolveService(ctx, entity)
          const method = service[`update${suffix}`]
          if (method) await method.call(service, { id, ...previousData })
        }
      : undefined,
  )
}

/**
 * Unified delete — resolves ALL links for this entity and does the right thing:
 * - Links with cascadeLeft → soft-delete children + pivot entries
 * - Links without cascade (many-to-many) → dismiss pivot entries only
 * - Then soft-delete the entity itself
 * One function. The framework knows the relationship types.
 */
interface DeleteResult {
  id: string
  deletedLinks: Array<{ tableName: string; linkId: string }>
  deletedChildren: Array<{ entity: string; id: string }>
  dismissedLinks: Array<{ tableName: string; linkId: string }>
}

async function stepDelete(entity: string, id: string, ctx: StepContext): Promise<DeleteResult> {
  const suffix = capitalize(pluralize(entity))
  const entityModule = entity.toLowerCase()

  return runStep(
    `delete-${entityModule}`,
    ctx,
    async () => {
      const service = resolveService(ctx, entity)
      const db = getDb(ctx)
      const deletedLinks: DeleteResult['deletedLinks'] = []
      const deletedChildren: DeleteResult['deletedChildren'] = []
      const dismissedLinks: DeleteResult['dismissedLinks'] = []

      const allLinks = resolveLinks(ctx).filter((l) => l.leftModule === entityModule || l.leftEntity === entity)

      for (const link of allLinks) {
        const linkTable = getLinkTable(ctx, link.tableName)
        const leftCol = getColumn(linkTable, link.leftFk)
        const rightCol = getColumn(linkTable, link.rightFk)
        const idCol = getColumn(linkTable, 'id')
        const deletedAtCol = getColumn(linkTable, 'deleted_at')

        const rows = await db
          .select({
            id: idCol,
            child_id: rightCol,
          })
          .from(linkTable)
          .where(and(eq(leftCol, id), isNull(deletedAtCol)))

        if (link.cascadeLeft) {
          const childEntity = link.rightEntity
          const childSuffix = capitalize(pluralize(childEntity))
          let childService: Record<string, Function> | null = null
          try {
            childService = resolveService(ctx, childEntity)
          } catch {
            /* not loaded */
          }

          for (const row of rows) {
            const childId = row.child_id as string
            if (childService) {
              const softDel = childService[`softDelete${childSuffix}`]
              if (softDel) {
                await softDel.call(childService, [childId])
                deletedChildren.push({ entity: childEntity, id: childId })
              }
            }
            const linkId = row.id as string
            await db.update(linkTable).set({ deleted_at: new Date() }).where(eq(idCol, linkId))
            deletedLinks.push({ tableName: link.tableName, linkId })
          }
        } else {
          for (const row of rows) {
            const linkId = row.id as string
            await db.delete(linkTable).where(eq(idCol, linkId))
            dismissedLinks.push({ tableName: link.tableName, linkId })
          }
        }
      }

      const softDel = service[`softDelete${suffix}`]
      if (softDel) await softDel.call(service, [id])

      return { id, deletedLinks, deletedChildren, dismissedLinks }
    },
    async (output) => {
      const service = resolveService(ctx, entity)
      const db = getDb(ctx)

      const restoreMethod = service[`restore${suffix}`]
      if (restoreMethod) await restoreMethod.call(service, [output.id])

      for (const child of output.deletedChildren) {
        try {
          const childService = resolveService(ctx, child.entity)
          const childSuffix = capitalize(pluralize(child.entity))
          const childRestore = childService[`restore${childSuffix}`]
          if (childRestore) await childRestore.call(childService, [child.id])
        } catch {
          /* best effort */
        }
      }

      for (const link of output.deletedLinks) {
        const linkTable = getLinkTable(ctx, link.tableName)
        const idCol = getColumn(linkTable, 'id')
        await db.update(linkTable).set({ deleted_at: null }).where(eq(idCol, link.linkId))
      }

      for (const link of output.dismissedLinks) {
        const linkTable = getLinkTable(ctx, link.tableName)
        await db
          .insert(linkTable)
          .values({
            id: link.linkId,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .onConflictDoNothing()
      }
    },
  )
}

// stepCascadeDelete removed — stepDelete handles cascade automatically

// ---------------------------------------------------------------------------
// Entity ref — tagged objects returned by step.service.*.create/update
// ---------------------------------------------------------------------------

/** Symbol used to tag objects with their entity name (set by create/update steps). */
export const ENTITY_TAG = Symbol.for('manta:entity')

/** An entity ref for step.link() — either a tagged object or an explicit { entity, id }. */
export interface EntityRef {
  entity: string
  id: string
}

function isTaggedEntity(obj: unknown): obj is Record<string, unknown> & { [ENTITY_TAG]: string } {
  return typeof obj === 'object' && obj !== null && ENTITY_TAG in obj
}

function resolveEntityRef(arg: unknown): EntityRef {
  if (isTaggedEntity(arg)) {
    return { entity: (arg as Record<symbol, string>)[ENTITY_TAG], id: (arg as Record<string, unknown>).id as string }
  }
  if (typeof arg === 'object' && arg !== null && 'entity' in arg && 'id' in arg) {
    return arg as EntityRef
  }
  throw new MantaError(
    'INVALID_DATA',
    'step.link() arguments must be entity objects (from step.service.*.create()) ' +
      'or explicit refs { entity: "product", id: "prod_123" }.',
  )
}

/**
 * Find a link definition between two entities (order-agnostic).
 * Returns the link and whether the arguments are in the same order as the link definition.
 */
function findLinkDef(
  ctx: StepContext,
  entityA: string,
  entityB: string,
): { link: ResolvedLink; leftId: 'a' | 'b' } | null {
  const links = resolveLinks(ctx)
  const aLower = entityA.toLowerCase()
  const bLower = entityB.toLowerCase()

  // Try A=left, B=right
  const forward = links.find(
    (l) =>
      (l.leftEntity === entityA || l.leftEntity.toLowerCase() === aLower) &&
      (l.rightEntity === entityB || l.rightEntity.toLowerCase() === bLower),
  )
  if (forward) return { link: forward, leftId: 'a' }

  // Try B=left, A=right
  const reverse = links.find(
    (l) =>
      (l.leftEntity === entityB || l.leftEntity.toLowerCase() === bLower) &&
      (l.rightEntity === entityA || l.rightEntity.toLowerCase() === aLower),
  )
  if (reverse) return { link: reverse, leftId: 'b' }

  return null
}

/**
 * List available link partners for an entity (for error messages).
 */
function availableLinksFor(ctx: StepContext, entity: string): string[] {
  const links = resolveLinks(ctx)
  const eLower = entity.toLowerCase()
  const partners: string[] = []
  for (const l of links) {
    if (l.leftEntity === entity || l.leftEntity.toLowerCase() === eLower) partners.push(l.rightEntity)
    if (l.rightEntity === entity || l.rightEntity.toLowerCase() === eLower) partners.push(l.leftEntity)
  }
  return [...new Set(partners)]
}

// ---------------------------------------------------------------------------
// step.link() — first-level link step
// ---------------------------------------------------------------------------

/**
 * Create a link between two entities.
 *
 * Accepts:
 *   step.link(product, item)                     — tagged objects from create()
 *   step.link(product, item, { quantity: 10 })   — with extra columns
 *   step.link(product, { entity: 'inventory_item', id: 'inv_123' })
 *   step.link({ entity: 'product', id: 'p1' }, { entity: 'inventory_item', id: 'p2' }, { qty: 1 })
 *
 * Validations:
 *   1. Link must exist in defineLink registry
 *   2. Required extra columns must be provided
 *   3. Unknown extra columns are rejected
 */
async function stepLink(
  a: unknown,
  b: unknown,
  extraColumns: Record<string, unknown> | undefined,
  ctx: StepContext,
): Promise<{ linkId: string }> {
  const refA = resolveEntityRef(a)
  const refB = resolveEntityRef(b)

  // 1. Find link definition (order-agnostic)
  const found = findLinkDef(ctx, refA.entity, refB.entity)
  if (!found) {
    const partnersA = availableLinksFor(ctx, refA.entity)
    const partnersB = availableLinksFor(ctx, refB.entity)
    const hint =
      partnersA.length > 0
        ? `Available links for ${refA.entity}: [${partnersA.join(', ')}].`
        : partnersB.length > 0
          ? `Available links for ${refB.entity}: [${partnersB.join(', ')}].`
          : 'No links defined. Add a defineLink() in src/links/.'
    throw new MantaError('NOT_FOUND', `Cannot link ${refA.entity} to ${refB.entity} — no defineLink found. ${hint}`)
  }

  const { link: linkDef, leftId: leftSide } = found
  const leftId = leftSide === 'a' ? refA.id : refB.id
  const rightId = leftSide === 'a' ? refB.id : refA.id

  // 2. Validate extra columns
  const definedExtras = linkDef.extraColumns ?? {}
  const definedKeys = Object.keys(definedExtras)
  const providedKeys = Object.keys(extraColumns ?? {})

  // Check for unknown columns
  for (const key of providedKeys) {
    if (!definedKeys.includes(key)) {
      throw new MantaError(
        'INVALID_DATA',
        `Unknown column "${key}" on link ${refA.entity} ↔ ${refB.entity}. ` +
          (definedKeys.length > 0
            ? `Available extra columns: [${definedKeys.join(', ')}].`
            : 'This link has no extra columns.'),
      )
    }
  }

  // Check for required extra columns (those without defaults)
  for (const key of definedKeys) {
    const def = definedExtras[key] as Record<string, unknown> | undefined
    const hasDefault = def && ('default_value' in def || 'is_nullable' in def)
    if (!hasDefault && !(extraColumns && key in extraColumns)) {
      throw new MantaError(
        'INVALID_DATA',
        `Link ${refA.entity} ↔ ${refB.entity} requires extra column "${key}". ` +
          `Pass it as the third argument: step.link(a, b, { ${key}: value }).`,
      )
    }
  }

  const leftKey = linkDef.leftEntity.toLowerCase()
  const rightKey = linkDef.rightEntity.toLowerCase()
  const linkId = `link_${leftId}_${rightId}`

  return runStep(
    `link-${leftKey}-${rightKey}`,
    ctx,
    async () => {
      const db = getDb(ctx)
      const linkTable = getLinkTable(ctx, linkDef.tableName)
      await db.insert(linkTable).values({
        id: linkId,
        [linkDef.leftFk]: leftId,
        [linkDef.rightFk]: rightId,
        ...(extraColumns ?? {}),
        created_at: new Date(),
        updated_at: new Date(),
      })
      return { linkId }
    },
    async () => {
      const db = getDb(ctx)
      const linkTable = getLinkTable(ctx, linkDef.tableName)
      const idCol = getColumn(linkTable, 'id')
      await db.delete(linkTable).where(eq(idCol, linkId))
    },
  )
}

/**
 * Legacy: Create a link with explicit entity names and IDs.
 * Used by the old bound proxy in defineCommand.
 */
function stepLinkExplicit(
  leftEntity: string,
  leftId: string,
  rightEntity: string,
  rightId: string,
  ctx: StepContext,
  extraColumns?: Record<string, unknown>,
): Promise<{ linkId: string }> {
  return stepLink({ entity: leftEntity, id: leftId }, { entity: rightEntity, id: rightId }, extraColumns, ctx)
}

// ---------------------------------------------------------------------------
// step.unlink() — remove a link between two entities
// ---------------------------------------------------------------------------

/**
 * Remove a link between two entities (delete from pivot table).
 * Compensation re-creates the link.
 *
 * @example
 *   step.unlink(customer, group)
 *   step.unlink({ entity: 'customer', id: 'cus_1' }, { entity: 'customer_group', id: 'grp_1' })
 */
function stepUnlink(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  ctx: StepContext,
): Promise<{ success: boolean }> {
  const refA = resolveEntityRef(a)
  const refB = resolveEntityRef(b)
  const found = findLinkDef(ctx, refA.entity, refB.entity)
  if (!found) {
    throw new MantaError(
      'NOT_FOUND',
      `No defineLink found between "${refA.entity}" and "${refB.entity}". Create one in src/links/ or src/modules/{mod}/links/.`,
    )
  }
  const link = found.link

  const leftId = link.leftEntity.toLowerCase() === refA.entity.toLowerCase() ? refA.id : refB.id
  const rightId = link.leftEntity.toLowerCase() === refA.entity.toLowerCase() ? refB.id : refA.id

  const leftKey = link.leftEntity.toLowerCase()
  const rightKey = link.rightEntity.toLowerCase()

  return runStep(
    `unlink-${leftKey}-${rightKey}`,
    ctx,
    async () => {
      const db = getDb(ctx)
      const linkTable = getLinkTable(ctx, link.tableName)
      const leftFkCol = getColumn(linkTable, link.leftFk)
      const rightFkCol = getColumn(linkTable, link.rightFk)
      await db.delete(linkTable).where(and(eq(leftFkCol, leftId), eq(rightFkCol, rightId)))
      return { success: true }
    },
    async () => {
      // Compensation: re-create the link
      const db = getDb(ctx)
      const linkTable = getLinkTable(ctx, link.tableName)
      await db.insert(linkTable).values({
        id: `link_${leftId}_${rightId}`,
        [link.leftFk]: leftId,
        [link.rightFk]: rightId,
        created_at: new Date(),
        updated_at: new Date(),
      })
    },
  )
}

async function stepInvoke(moduleName: string, methodName: string, args: unknown[], ctx: StepContext): Promise<unknown> {
  return runStep(
    `invoke-${moduleName}-${methodName}`,
    ctx,
    async () => {
      const service = resolveService(ctx, moduleName)
      const method = service[methodName]
      if (!method) throw new MantaError('NOT_FOUND', `Service "${moduleName}" has no method "${methodName}"`)
      // Clear snapshots before executing so we only track this method's mutations
      const snapshotRepo = (service as Record<string, unknown>).__snapshotRepo as
        | SnapshotRepository<Record<string, unknown>>
        | undefined
      if (snapshotRepo) snapshotRepo.clearSnapshots()
      return method.apply(service, args)
    },
    async () => {
      // Auto-compensation via SnapshotRepository — rollback all mutations made during the method
      const service = resolveService(ctx, moduleName)
      const snapshotRepo = (service as Record<string, unknown>).__snapshotRepo as
        | SnapshotRepository<Record<string, unknown>>
        | undefined
      if (snapshotRepo?.hasSnapshots) await snapshotRepo.rollback()
    },
  )
}

async function stepEmit(eventName: string, data: Record<string, unknown>, ctx: StepContext): Promise<void> {
  return runStep(`emit-${eventName}`, ctx, async () => {
    const eventBus = ctx.app.infra.eventBus
    await eventBus.emit({ eventName, data, metadata: { timestamp: Date.now() } })
  })
}

// ---------------------------------------------------------------------------
// Module Proxy — step.product.create(...), step.product.activate(...), etc.
// ---------------------------------------------------------------------------

function createLinkProxy(entityName: string): Record<string, Function> {
  const leftEntity = entityName
  return new Proxy({} as Record<string, Function>, {
    get(_target, rightEntityProp: string) {
      // step.product.link.inventoryItem(ctx) — IDs auto-resolved
      // step.product.link.inventoryItem(extraColumns, ctx) — with extra columns
      return (...args: unknown[]) => {
        const rightEntity = rightEntityProp.charAt(0).toUpperCase() + rightEntityProp.slice(1)
        const ctx = args[args.length - 1] as StepContext
        const leftId = findLastCreatedId(ctx, leftEntity)
        const rightId = findLastCreatedId(ctx, rightEntity)
        if (!leftId)
          throw new MantaError(
            'INVALID_DATA',
            `Cannot link: no ${leftEntity} created yet in this workflow. Call step.service.${leftEntity.toLowerCase()}.create() first.`,
          )
        if (!rightId)
          throw new MantaError(
            'INVALID_DATA',
            `Cannot link: no ${rightEntity} created yet in this workflow. Call step.service.${rightEntity.toLowerCase()}.create() first.`,
          )
        return stepLinkExplicit(leftEntity, leftId, rightEntity, rightId, ctx)
      }
    },
  })
}

function createModuleProxy(entityName: string): Record<string, unknown> {
  const entity = entityName.charAt(0).toUpperCase() + entityName.slice(1)

  return new Proxy({} as Record<string, unknown>, {
    get(_target, methodName: string) {
      switch (methodName) {
        case 'create':
          return (data: Record<string, unknown>, ctx: StepContext) => stepCreate(entity, data, ctx)
        case 'update':
          return (id: string, data: Record<string, unknown>, ctx: StepContext) => stepUpdate(entity, id, data, ctx)
        case 'delete':
          return (id: string, ctx: StepContext) => stepDelete(entity, id, ctx)
        case 'link':
          return createLinkProxy(entity)
        default:
          // Any other method → resolve from service (compensable methods like activate, archive)
          return (...args: unknown[]) => {
            const ctx = args[args.length - 1] as StepContext
            const methodArgs = args.slice(0, -1)
            return stepInvoke(entityName, methodName, methodArgs, ctx)
          }
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Legacy types (kept for backward compat)
// ---------------------------------------------------------------------------

export interface CrudStepConfig {
  entity: string
  serviceSuffix?: string
}

export interface ActionStepConfig<TInput = unknown, TOutput = unknown> {
  invoke: (input: TInput, ctx: StepContext) => Promise<TOutput>
  compensate: (output: TOutput, ctx: StepContext) => Promise<void>
}

// ---------------------------------------------------------------------------
// Dismiss link step
// ---------------------------------------------------------------------------

async function stepDismissLink(
  leftEntity: string,
  leftId: string,
  rightEntity: string,
  rightId: string,
  ctx: StepContext,
): Promise<void> {
  const leftKey = leftEntity.toLowerCase()
  const rightKey = rightEntity.toLowerCase()
  const links = resolveLinks(ctx)
  const linkDef = links.find(
    (l) =>
      (l.leftEntity === leftEntity || l.leftEntity.toLowerCase() === leftKey) &&
      (l.rightEntity === rightEntity || l.rightEntity.toLowerCase() === rightKey),
  )
  if (!linkDef) throw new MantaError('NOT_FOUND', `No link defined between "${leftEntity}" and "${rightEntity}"`)

  return runStep(
    `dismiss-link-${leftKey}-${rightKey}`,
    ctx,
    async () => {
      const db = getDb(ctx)
      const linkTable = getLinkTable(ctx, linkDef.tableName)
      const leftCol = getColumn(linkTable, linkDef.leftFk)
      const rightCol = getColumn(linkTable, linkDef.rightFk)
      await db.delete(linkTable).where(and(eq(leftCol, leftId), eq(rightCol, rightId)))
    },
    async () => {
      const db = getDb(ctx)
      const linkTable = getLinkTable(ctx, linkDef.tableName)
      const linkId = `link_${leftId}_${rightId}`
      await db.insert(linkTable).values({
        id: linkId,
        [linkDef.leftFk]: leftId,
        [linkDef.rightFk]: rightId,
        created_at: new Date(),
        updated_at: new Date(),
      })
    },
  )
}

// ---------------------------------------------------------------------------
// Public API — step Proxy
//
// 4 categories:
//   step.service.catalog.create({...}, ctx)    — service CRUD + compensable methods
//   step.command.createProduct({...}, ctx)      — sub-workflow (command invocation)
//   step.action('name', { invoke, compensate }) — custom external action
//   step.emit('event.name', data, ctx)          — fire-and-forget event
// ---------------------------------------------------------------------------

function stepAction<TInput = unknown, TOutput = unknown>(
  name: string,
  config: ActionStepConfig<TInput, TOutput>,
): (input: TInput, ctx: StepContext) => Promise<TOutput> {
  if (!config.compensate) {
    throw new MantaError(
      'INVALID_DATA',
      `step.action("${name}") requires a compensate function. Usage: step.action("${name}", { invoke: async (input) => {...}, compensate: async (result) => {...} })`,
    )
  }
  return async (input: TInput, ctx: StepContext): Promise<TOutput> => {
    return runStep(
      name,
      ctx,
      () => config.invoke(input, ctx),
      (output) => config.compensate(output, ctx),
    )
  }
}

/**
 * Service proxy — step.service.catalog.create(), step.service.catalog.activate()
 * Accessed via step.service.MODULE_NAME
 */
function createServiceNamespace(): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, moduleName: string) {
      return createModuleProxy(moduleName)
    },
  })
}

// ---------------------------------------------------------------------------
// Link namespace — step.link.<linkName>.{ list, create, delete, update }
// Pivot-backed CRUD on link tables. Intra-module FK-backed links throw
// NOT_SUPPORTED — will be implemented when the first use case appears.
// ---------------------------------------------------------------------------

/** Convert 'customerAddress' → 'customer_address' (matches ResolvedLink.tableName). */
function linkNameToTableName(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
}

/** Convert 'customer_address' → 'customerAddress' (used for available-link hints). */
function tableNameToLinkName(tableName: string): string {
  return tableName.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase())
}

/** Resolve a ResolvedLink by its user-facing camelCase name. Throws if not found or FK-backed. */
function resolveLinkByName(ctx: StepContext, name: string): ResolvedLink {
  const expected = linkNameToTableName(name)
  const links = resolveLinks(ctx)
  const link = links.find((l) => l.tableName === expected)
  if (!link) {
    const available = links.map((l) => tableNameToLinkName(l.tableName)).join(', ')
    throw new MantaError(
      'NOT_FOUND',
      `Link "${name}" not found. Available links: [${available}]. Define it via defineLink() in src/links/ or src/modules/*/links/.`,
    )
  }
  if (link.isDirectFk) {
    throw new MantaError(
      'NOT_SUPPORTED',
      `Link "${name}" is FK-backed (intra-module ${link.cardinality}). step.link.${name}.* is only implemented for pivot-backed links currently. Use step.service.<entity>.update() to manipulate the FK column directly.`,
    )
  }
  return link
}

/** Build a drizzle WHERE clause from a plain {col: value} object. */
// biome-ignore lint/suspicious/noExplicitAny: drizzle column types are dynamic
function buildWhere(table: PgTable, where: Record<string, unknown>): any {
  const conditions = Object.entries(where).map(([key, value]) => {
    const col = getColumn(table, key)
    return value === null ? isNull(col) : eq(col, value)
  })
  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return and(...conditions)
}

/**
 * Link proxy — step.link.customerAddress.list({ customer_id, type: 'billing' })
 *
 * API (parallel to a model service CRUD):
 *   list(where)            → pivot rows matching the where clause
 *   create(data)           → insert a pivot row (data must include both FKs + any required extras)
 *   update(where, patch)   → update extra columns on matching pivot rows
 *   delete(where)          → delete matching pivot rows
 *
 * For pivot-backed links only. FK-backed intra-module links throw NOT_SUPPORTED
 * at resolution time with a clear message.
 */
function createLinkNamespace(): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, linkName: string) {
      return {
        list: async (where: Record<string, unknown>, ctx: StepContext) => {
          const link = resolveLinkByName(ctx, linkName)
          return runStep(`link-list-${link.tableName}`, ctx, async () => {
            const db = getDb(ctx)
            const table = getLinkTable(ctx, link.tableName)
            const whereClause = buildWhere(table, where ?? {})
            const query = db.select().from(table)
            const rows = whereClause ? await query.where(whereClause) : await query
            return rows as Record<string, unknown>[]
          })
        },
        create: async (data: Record<string, unknown>, ctx: StepContext) => {
          const link = resolveLinkByName(ctx, linkName)
          if (!(link.leftFk in data) || !(link.rightFk in data)) {
            throw new MantaError(
              'INVALID_DATA',
              `step.link.${linkName}.create requires both "${link.leftFk}" and "${link.rightFk}" in the payload.`,
            )
          }
          const leftId = data[link.leftFk]
          const rightId = data[link.rightFk]
          const linkId = `link_${leftId}_${rightId}`
          return runStep(
            `link-create-${link.tableName}`,
            ctx,
            async () => {
              const db = getDb(ctx)
              const table = getLinkTable(ctx, link.tableName)
              const now = new Date()
              await db.insert(table).values({
                id: linkId,
                ...data,
                created_at: now,
                updated_at: now,
              })
              return { id: linkId, ...data }
            },
            async () => {
              const db = getDb(ctx)
              const table = getLinkTable(ctx, link.tableName)
              const idCol = getColumn(table, 'id')
              await db.delete(table).where(eq(idCol, linkId))
            },
          )
        },
        update: async (where: Record<string, unknown>, patch: Record<string, unknown>, ctx: StepContext) => {
          const link = resolveLinkByName(ctx, linkName)
          const extraKeys = Object.keys(link.extraColumns ?? {})
          if (extraKeys.length === 0) {
            throw new MantaError(
              'NOT_SUPPORTED',
              `Link "${linkName}" has no extra columns to update. step.link.${linkName}.update requires defined extraColumns on defineLink().`,
            )
          }
          for (const key of Object.keys(patch)) {
            if (!extraKeys.includes(key)) {
              throw new MantaError(
                'INVALID_DATA',
                `Unknown column "${key}" on link "${linkName}". Available extras: [${extraKeys.join(', ')}].`,
              )
            }
          }
          return runStep(`link-update-${link.tableName}`, ctx, async () => {
            const db = getDb(ctx)
            const table = getLinkTable(ctx, link.tableName)
            const whereClause = buildWhere(table, where ?? {})
            if (!whereClause) {
              throw new MantaError('INVALID_DATA', `step.link.${linkName}.update requires a non-empty where clause.`)
            }
            await db
              .update(table)
              .set({ ...patch, updated_at: new Date() })
              .where(whereClause)
            return { ok: true }
          })
        },
        delete: async (where: Record<string, unknown>, ctx: StepContext) => {
          const link = resolveLinkByName(ctx, linkName)
          return runStep(`link-delete-${link.tableName}`, ctx, async () => {
            const db = getDb(ctx)
            const table = getLinkTable(ctx, link.tableName)
            const whereClause = buildWhere(table, where ?? {})
            if (!whereClause) {
              throw new MantaError('INVALID_DATA', `step.link.${linkName}.delete requires a non-empty where clause.`)
            }
            await db.delete(table).where(whereClause)
            return { ok: true }
          })
        },
      }
    },
  })
}

/**
 * Command proxy — step.command.createProduct(), step.command.catalog.activateProduct()
 * Resolves commands from CommandRegistry and executes them as sub-workflows.
 */
function createCommandNamespace(): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, commandName: string) {
      // step.command.createProduct(input, ctx) → resolves command and runs it
      return async (input: unknown, ctx: StepContext) => {
        return runStep(
          `command-${commandName}`,
          ctx,
          async () => {
            // Resolve the command callable from the app
            const camelCase = commandName.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase())
            const commands = ctx.app.commands as Record<string, (input: unknown) => Promise<unknown>>
            const callable = commands[camelCase] ?? commands[commandName]
            if (!callable) {
              throw new MantaError('NOT_FOUND', `Command "${commandName}" not found in app.commands`)
            }
            return callable(input)
          },
          // Commands handle their own compensation via their internal workflow
        )
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Agent step — step.agent.NAME(input, ctx)
// AI SDK imports are in a separate file (ai-step.ts) to avoid compile-time
// dependency on the 'ai' package. Loaded dynamically via require().
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: AgentDefinition generic
async function stepAgent(agentDef: any, input: unknown, ctx: StepContext): Promise<unknown> {
  const parsed = agentDef.input.parse(input)
  const promptText = agentDef.instructions({ input: parsed })

  return runStep(`agent-${agentDef.name}`, ctx, async () => {
    // Dynamic require to avoid compile-time dependency on AI SDK
    // biome-ignore lint/suspicious/noExplicitAny: dynamic import path
    const aiStepPath = ['./ai', '-step'].join('')
    // biome-ignore lint/suspicious/noExplicitAny: dynamic module
    const mod = require(aiStepPath) as any
    return mod.executeAgent(agentDef, parsed, promptText)
  })
}

/**
 * Agent proxy — step.agent.categorizeProduct(input, ctx)
 * Resolves agent definitions from __agentRegistry in app.
 */
function createAgentNamespace(): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, agentName: string) {
      return async (input: unknown, ctx: StepContext) => {
        // Resolve agent definition from registry
        // biome-ignore lint/suspicious/noExplicitAny: dynamic registry
        let registry: Map<string, any> | null = null
        try {
          registry = ctx.app.resolve<Map<string, unknown>>('__agentRegistry')
        } catch {
          throw new MantaError(
            'NOT_FOUND',
            `Agent "${agentName}" not found. No agents registered. Create agents in src/agents/.`,
          )
        }
        // Convert camelCase to kebab-case for lookup
        const kebab = agentName.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
        const agentDef = registry.get(kebab) ?? registry.get(agentName)
        if (!agentDef) {
          const available = [...registry.keys()].join(', ')
          throw new MantaError(
            'NOT_FOUND',
            `Agent "${agentName}" not found. Available agents: [${available}]. Create it in src/agents/${kebab}.ts.`,
          )
        }
        return stepAgent(agentDef, input, ctx)
      }
    },
  })
}

const stepBase = {
  emit: stepEmit,
  action: stepAction,
  service: createServiceNamespace() as MantaGeneratedAppModules,
  command: createCommandNamespace(),
  link: createLinkNamespace(),
  agent: createAgentNamespace(),

  // Low-level access (used by framework internals)
  create: stepCreate,
  update: stepUpdate,
  delete: stepDelete,
  linkExplicit: stepLinkExplicit,
  dismissLink: stepDismissLink,
  invoke: stepInvoke,
}

/**
 * step — Categorized workflow step API.
 *
 * Services (CRUD + compensable methods):
 *   step.service.catalog.create({ title: 'Widget' }, ctx)
 *   step.service.catalog.activate(id, ctx)
 *   step.service.catalog.link.inventoryItem(ctx)
 *   step.service.catalog.delete(id, ctx)
 *
 * Commands (sub-workflows):
 *   step.command.createProduct({ title: 'Widget' }, ctx)
 *
 * Agents (AI calls — typed input/output, checkpointed):
 *   step.agent.categorizeProduct({ title: 'Widget' }, ctx)
 *
 * Actions (external with required compensation):
 *   step.action('charge-payment', { invoke, compensate })(input, ctx)
 *
 * Events (fire-and-forget, buffered):
 *   step.emit('product.created', data, ctx)
 */
/**
 * Per-link CRUD (pivot-backed). FK-backed intra-module links throw NOT_SUPPORTED at runtime.
 */
export interface LinkCrud {
  list: (where: Record<string, unknown>, ctx: StepContext) => Promise<Record<string, unknown>[]>
  create: (data: Record<string, unknown>, ctx: StepContext) => Promise<Record<string, unknown>>
  update: (
    where: Record<string, unknown>,
    patch: Record<string, unknown>,
    ctx: StepContext,
  ) => Promise<{ ok: true }>
  delete: (where: Record<string, unknown>, ctx: StepContext) => Promise<{ ok: true }>
}

export interface MantaStep {
  emit: typeof stepEmit
  action: typeof stepAction
  service: MantaGeneratedAppModules
  command: Record<string, (input: unknown) => Promise<unknown>>
  link: Record<string, LinkCrud>
  agent: Record<string, (input: unknown) => Promise<unknown>>
  create: typeof stepCreate
  update: typeof stepUpdate
  delete: typeof stepDelete
  linkExplicit: typeof stepLinkExplicit
  dismissLink: typeof stepDismissLink
  invoke: typeof stepInvoke
}

// biome-ignore lint/suspicious/noExplicitAny: Proxy type intersection
export const step: MantaStep = new Proxy(stepBase, {
  // biome-ignore lint/suspicious/noExplicitAny: Proxy handler needs dynamic target type
  get(target: any, prop: string) {
    if (prop in target) return target[prop]
    // Fallback: treat unknown property as module name (backward compat during migration)
    return createModuleProxy(prop)
  },
  // biome-ignore lint/suspicious/noExplicitAny: Proxy type intersection
}) as any
