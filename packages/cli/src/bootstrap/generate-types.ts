// Generate .manta/generated.d.ts from discovered DML entities, services, commands, and subscribers.
// Runs in the CLI process (before Nitro starts), not in the Nitro worker.
//
// Generates a SINGLE file:
//   .manta/generated.d.ts — all type declarations merged

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { MantaError } from '@manta/core'
import { discoverResources } from '../resource-loader'
import { validateGeneratedTypeScript } from './validate-generated-ts'

// ── Identifier sanitization ──────────────────────────────────────────
// SPEC TS-04 — Reject invalid identifiers at the source with clear
// MantaError messages. Pairs with the output validator (belt + braces).

function assertSafeIdentifierComponent(value: string, kind: 'camelCase' | 'PascalCase', where: string): void {
  const pattern = kind === 'PascalCase' ? /^[A-Z][A-Za-z0-9]*$/ : /^[a-z][A-Za-z0-9]*$/
  if (!pattern.test(value)) {
    throw new MantaError('INVALID_DATA', `Invalid ${kind} identifier "${value}" in ${where}. Must match ${pattern}.`)
  }
}

// ── Inject globals so model imports work in standalone codegen ────────

async function injectGlobals() {
  const g = globalThis as Record<string, unknown>
  if (g.defineModel) return // Already injected
  const core = await import('@manta/core')
  g.defineModel = core.defineModel
  g.defineService = core.defineService
  g.defineLink = core.defineLink
  g.defineCommand = core.defineCommand
  g.defineAgent = core.defineAgent
  g.defineSubscriber = core.defineSubscriber
  g.defineJob = core.defineJob
  g.defineUserModel = core.defineUserModel
  g.defineQuery = core.defineQuery
  g.defineQueryGraph = core.defineQueryGraph
  g.extendQueryGraph = core.extendQueryGraph
  g.defineWorkflow = core.defineWorkflow
  g.defineConfig = core.defineConfig
  g.definePreset = core.definePreset
  g.defineMiddleware = core.defineMiddleware
  g.field = core.field
  g.many = core.many
  const { z } = await import('zod')
  g.z = z
}

// ── Pluralization (must match instantiate.ts) ────────────────────────

function pluralize(name: string): string {
  if (name.endsWith('s') || name.endsWith('x') || name.endsWith('ch') || name.endsWith('sh')) return `${name}es`
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`
  return `${name}s`
}

// ── Module entry collection ──────────────────────────────────────────

interface ModuleEntry {
  moduleName: string
  entityName: string
  entityExportName: string
  modulePath: string
  customMethods: string[]
  /** True when the original export was `export default` — requires default import syntax */
  isDefaultExport?: boolean
  /** True when the entity is external (lives in a third-party system, no local table/CRUD) */
  isExternal?: boolean
}

async function collectModuleEntries(resources: Awaited<ReturnType<typeof discoverResources>>): Promise<ModuleEntry[]> {
  const entries: ModuleEntry[] = []

  // Also include user models (defineUserModel) as module entities
  for (const userInfo of resources.users) {
    try {
      const mod = (await import(`${userInfo.path}?t=${Date.now()}`)) as Record<string, unknown>
      const def = (mod.default ?? mod) as Record<string, unknown>
      if (def?.__type === 'user' && def?.model) {
        const model = def.model as { name: string; schema: unknown }
        const contextName = def.contextName as string
        assertSafeIdentifierComponent(model.name, 'PascalCase', `defineUserModel in ${userInfo.path}`)
        // Find the module this user belongs to
        const parentModule =
          resources.modules.find((m) => m.entities.some((e) => e.modelPath === userInfo.path)) ??
          resources.modules.find((m) => m.name === contextName)
        const moduleName = parentModule?.name ?? contextName

        // Use a unique export alias for the user model
        const alias = `${model.name}UserDef`
        entries.push({
          moduleName,
          entityName: model.name,
          entityExportName: alias,
          modulePath: userInfo.path,
          customMethods: [],
          isUserModel: true,
        } as ModuleEntry & { isUserModel?: boolean })
      }
    } catch (err) {
      // Propagate validation errors (bad identifiers); swallow only true import failures.
      if (MantaError.is(err)) throw err
      // User model not importable
    }
  }

  for (const modInfo of resources.modules) {
    for (const entity of modInfo.entities) {
      try {
        const mod = (await import(`${entity.modelPath}?t=${Date.now()}`)) as Record<string, unknown>

        // Find the DML entity export — support both DmlEntity and UserDefinition
        let entityExportName = ''
        let entityName = ''
        let isExternal = false

        for (const [exportName, value] of Object.entries(mod)) {
          // Standard DmlEntity
          if (
            typeof value === 'object' &&
            value !== null &&
            'name' in value &&
            'schema' in value &&
            typeof (value as Record<string, unknown>).name === 'string' &&
            typeof (value as Record<string, unknown>).getOptions === 'function'
          ) {
            const v = value as any
            entityExportName = exportName
            entityName = v.name
            const opts = v.getOptions?.() as { external?: boolean } | undefined
            isExternal = opts?.external === true
            break
          }
          // UserDefinition — skip in entity loop, handled by user model loop above
          if (typeof value === 'object' && value !== null && (value as any).__type === 'user') {
            break // Skip — already added by user model loop
          }
        }

        if (!entityExportName) continue

        assertSafeIdentifierComponent(entityName, 'PascalCase', `defineModel in ${entity.modelPath}`)

        // Fix: 'default' is a reserved word — alias it to the entity name
        let isDefaultExport = false
        if (entityExportName === 'default') {
          entityExportName = `${entityName}Model`
          isDefaultExport = true
        }

        // Find custom compensable methods from the service.ts (if it exists)
        const customMethods: string[] = []
        if (entity.servicePath) {
          try {
            const serviceMod = (await import(`${entity.servicePath}?t=${Date.now()}`)) as Record<string, unknown>
            const defaultExport = serviceMod.default as Record<string, unknown> | undefined
            if (defaultExport?.__type && typeof defaultExport.factory === 'function') {
              const fakeRepo = new Proxy(
                {},
                {
                  get: () => async () => [],
                },
              )
              const methods = (defaultExport.factory as (repo: unknown) => Record<string, unknown>)(fakeRepo)
              for (const [methodName, fn] of Object.entries(methods)) {
                if (typeof fn === 'function') {
                  customMethods.push(methodName)
                }
              }
            }
          } catch {
            // Service may fail with fake repo — skip custom methods
          }
        }

        entries.push({
          moduleName: modInfo.name,
          entityName,
          entityExportName,
          modulePath: entity.modelPath,
          customMethods,
          isDefaultExport,
          isExternal,
        })
      } catch (err) {
        // Propagate validation errors (bad identifiers); swallow only true import failures.
        if (MantaError.is(err)) throw err
        // Entity model may not be importable — skip
      }
    }
  }

  return entries
}

// ── Event collection from commands and subscribers ────────────────────

interface EventEntry {
  eventName: string
  sourceFile: string
  sourceType: 'command' | 'subscriber' | 'crud'
  /** Extracted data shape fields (best-effort from source analysis) */
  dataFields?: Record<string, string>
}

/**
 * Try to extract the object literal from a step.emit() / app.emit() call.
 * Best-effort: parses `{ key: value, key2: value2 }` after the event name.
 * Returns field names with inferred TS types, or undefined if unparseable.
 */
function extractEmitDataShape(content: string, eventName: string): Record<string, string> | undefined {
  // Match .emit('eventName', { ... })
  const escaped = eventName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`\\.emit\\(\\s*['"]${escaped}['"]\\s*,\\s*\\{([^}]+)\\}`, 's')
  const match = pattern.exec(content)
  if (!match) return undefined

  const body = match[1]
  const fields: Record<string, string> = {}

  // Match property patterns: `key: expr` or `key,` (shorthand)
  const propPattern = /(\w+)\s*(?::\s*([^,\n}]+?))?(?:\s*[,\n}])/g
  let propMatch: RegExpExecArray | null = null
  // biome-ignore lint/suspicious/noAssignInExpressions: regex iteration
  while ((propMatch = propPattern.exec(body)) !== null) {
    const key = propMatch[1]
    const value = propMatch[2]?.trim()

    // Infer type from the value expression
    if (!value || value.startsWith('input.')) {
      fields[key] = 'unknown'
    } else if (/^['"]/.test(value)) {
      fields[key] = 'string'
    } else if (/^\d+/.test(value)) {
      fields[key] = 'number'
    } else if (value === 'true' || value === 'false') {
      fields[key] = 'boolean'
    } else {
      fields[key] = 'unknown'
    }
  }

  return Object.keys(fields).length > 0 ? fields : undefined
}

async function collectEvents(resources: Awaited<ReturnType<typeof discoverResources>>): Promise<EventEntry[]> {
  const events: EventEntry[] = []
  const seen = new Set<string>()

  // Extract event names from subscriber definitions
  for (const subInfo of resources.subscribers) {
    try {
      const mod = (await import(`${subInfo.path}?t=${Date.now()}`)) as Record<string, unknown>
      const sub = mod.default as Record<string, unknown> | undefined
      if (sub?.event) {
        const eventNames = Array.isArray(sub.event) ? sub.event : [sub.event]
        for (const name of eventNames) {
          const eventName = name as string
          if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(eventName)) {
            throw new MantaError(
              'INVALID_DATA',
              `Invalid subscriber event name "${eventName}" in ${subInfo.path}. Must be alphanumeric with dots/hyphens.`,
            )
          }
          if (!seen.has(eventName)) {
            seen.add(eventName)
            events.push({ eventName, sourceFile: subInfo.path, sourceType: 'subscriber' })
          }
        }
      }
    } catch (err) {
      if (MantaError.is(err)) throw err
      // Skip
    }
  }

  // Extract event names + data shapes from command files (step.emit calls)
  for (const cmdInfo of resources.commands) {
    try {
      const content = readFileSync(cmdInfo.path, 'utf-8')
      // Match step.emit('event.name', ...) and app.emit('event.name', ...)
      const emitPattern = /\.emit\(\s*['"]([a-z][a-z0-9.-]+)['"]/g
      let match: RegExpExecArray | null = null
      // biome-ignore lint/suspicious/noAssignInExpressions: regex iteration
      while ((match = emitPattern.exec(content)) !== null) {
        const name = match[1]
        if (!seen.has(name)) {
          seen.add(name)
          const dataFields = extractEmitDataShape(content, name)
          events.push({ eventName: name, sourceFile: cmdInfo.path, sourceType: 'command', dataFields })
        }
      }
    } catch {
      // Skip
    }
  }

  // Also scan subscriber files for app.emit() calls (cascading events)
  for (const subInfo of resources.subscribers) {
    try {
      const content = readFileSync(subInfo.path, 'utf-8')
      const emitPattern = /\.emit\(\s*['"]([a-z][a-z0-9.-]+)['"]/g
      let match: RegExpExecArray | null = null
      // biome-ignore lint/suspicious/noAssignInExpressions: regex iteration
      while ((match = emitPattern.exec(content)) !== null) {
        const name = match[1]
        if (!seen.has(name)) {
          seen.add(name)
          const dataFields = extractEmitDataShape(content, name)
          events.push({ eventName: name, sourceFile: subInfo.path, sourceType: 'subscriber', dataFields })
        }
      }
    } catch {
      // Skip
    }
  }

  return events
}

// ── Main entry point ─────────────────────────────────────────────────

/**
 * Scan src/ for modules, commands, subscribers and generate typed declarations.
 *
 * Generates a single file: .manta/generated.d.ts
 */
export async function generateTypesFromModules(cwd: string): Promise<void> {
  const mantaDir = resolve(cwd, '.manta')
  if (!existsSync(mantaDir)) mkdirSync(mantaDir, { recursive: true })

  // Clean up old codegen directories if they exist
  for (const old of ['types', '../.manta-types']) {
    const oldDir = resolve(mantaDir, old)
    if (existsSync(oldDir)) rmSync(oldDir, { recursive: true, force: true })
  }

  // Inject globals (defineModel, defineService, etc.) so model imports work standalone
  await injectGlobals()

  // Load config + resolve plugins, so plugin-contributed modules/entities show up in codegen
  let resources = await discoverResources(cwd)
  try {
    const { loadConfig } = await import('../config/load-config')
    const { resolvePlugins } = await import('../plugins/resolve-plugins')
    const { mergePluginResources } = await import('../plugins/merge-resources')
    const config = await loadConfig(cwd)
    if (config) {
      const plugins = resolvePlugins(config, cwd)
      if (plugins.length > 0) {
        resources = await mergePluginResources(plugins, resources)
      }
    }
  } catch {
    // Config may not exist yet (e.g. during postinstall of the CLI itself) — ignore
  }

  const entries = await collectModuleEntries(resources)
  const events = await collectEvents(resources)

  if (entries.length === 0) return

  const outPath = resolve(mantaDir, 'generated.d.ts')
  const lines: string[] = [
    '// Auto-generated by manta dev — DO NOT EDIT',
    '// Provides typed app.modules.*, step.catalog.*, event.data, step.command.*, step.agent.*, etc.',
    '// Regenerated on every boot when modules/commands/subscribers/agents change.',
    '',
  ]

  // ── Imports ─────────────────────────────────────────────────────────

  lines.push("import type { InferEntity } from '@manta/core'")
  lines.push("import type { ServiceConfig } from '@manta/core'")

  // Entity imports (deduplicated by export name)
  const seenImports = new Set<string>()
  for (const entry of entries) {
    const key = `${entry.entityExportName}@${entry.modulePath}`
    if (seenImports.has(key)) continue
    seenImports.add(key)
    const relPath = relative(mantaDir, entry.modulePath).replace(/\.ts$/, '')
    const isUser = (entry as any).isUserModel
    if (isUser || entry.isDefaultExport) {
      // Default export: use default import with alias
      lines.push(`import type ${entry.entityExportName} from '${relPath}'`)
    } else {
      lines.push(`import type { ${entry.entityExportName} } from '${relPath}'`)
    }
  }

  // Agent imports
  const agentEntries = resources.agents.map((a) => {
    const camel = a.id.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase())
    assertSafeIdentifierComponent(camel, 'camelCase', `defineAgent in ${a.path}`)
    return {
      kebab: a.id,
      camel,
      path: a.path,
    }
  })

  if (agentEntries.length > 0) {
    lines.push("import type { z } from 'zod'")
    for (const agent of agentEntries) {
      const relPath = relative(mantaDir, agent.path).replace(/\.ts$/, '')
      lines.push(`import type ${agent.camel}Def from '${relPath}'`)
    }
  }

  // ── Module-scoped entity types ──────────────────────────────────────

  lines.push('')

  // Group entries by module to fix the duplicate interface issue
  const moduleMap = new Map<string, ModuleEntry[]>()
  for (const entry of entries) {
    const existing = moduleMap.get(entry.moduleName) ?? []
    existing.push(entry)
    moduleMap.set(entry.moduleName, existing)
  }

  // Generate entity types and per-module interfaces
  for (const [moduleName, moduleEntries] of moduleMap) {
    for (const entry of moduleEntries) {
      const E = entry.entityExportName
      const name = entry.entityName
      const isUser = (entry as any).isUserModel

      if (isUser) {
        // For user models, generate the type manually from the DML schema
        // because InferEntity can't resolve the generic UserDefinition.model type
        try {
          const mod = (await import(`${entry.modulePath}?t=${Date.now()}`)) as Record<string, unknown>
          const def = (mod.default ?? mod) as { model?: { schema: Record<string, unknown> } }
          const schema = def?.model?.schema
          if (schema) {
            const fields: string[] = []
            for (const [key, prop] of Object.entries(schema)) {
              const meta = typeof (prop as any).parse === 'function' ? (prop as any).parse(key) : null
              if (!meta) continue
              const nullable = meta.nullable
              const dt = meta.dataType?.name ?? 'unknown'
              let tsType = 'unknown'
              switch (dt) {
                case 'text':
                  tsType = 'string'
                  break
                case 'number':
                case 'bigNumber':
                case 'float':
                case 'autoincrement':
                  tsType = 'number'
                  break
                case 'boolean':
                  tsType = 'boolean'
                  break
                case 'dateTime':
                  tsType = 'Date'
                  break
                case 'json':
                  tsType = 'any'
                  break
                case 'enum':
                  tsType = meta.values ? meta.values.map((v: string) => `'${v}'`).join(' | ') : 'string'
                  break
                case 'array':
                  tsType = 'unknown[]'
                  break
                default:
                  tsType = 'unknown'
              }
              fields.push(`  ${key}${nullable ? '?' : ''}: ${tsType}${nullable ? ' | null' : ''}`)
            }
            lines.push(
              `type ${name}Entity = { ${fields.join('; ')} } & { id: string; created_at: Date; updated_at: Date }`,
            )
          } else {
            lines.push(
              `type ${name}Entity = Record<string, unknown> & { id: string; created_at: Date; updated_at: Date }`,
            )
          }
        } catch {
          lines.push(
            `type ${name}Entity = Record<string, unknown> & { id: string; created_at: Date; updated_at: Date }`,
          )
        }
      } else {
        lines.push(`type ${name}Entity = InferEntity<typeof ${E}> & { id: string; created_at: Date; updated_at: Date }`)
      }
    }
    lines.push('')

    // Single interface per module with ALL entity methods
    lines.push(`interface ${moduleName}Module {`)
    for (const entry of moduleEntries) {
      const name = entry.entityName
      const plural = pluralize(name)

      // External entities: no local service, only query.graph() routing via extendQueryGraph.
      // Skip CRUD method generation — they would fail at runtime (no table).
      if (entry.isExternal) {
        lines.push(
          `  // ${name} is external — queried via query.graph({ entity: '${name.charAt(0).toLowerCase() + name.slice(1)}', ... })`,
        )
        continue
      }

      lines.push(`  retrieve${name}(id: string, config?: ServiceConfig): Promise<${name}Entity>`)
      lines.push(`  list${plural}(filters?: Partial<${name}Entity>, config?: ServiceConfig): Promise<${name}Entity[]>`)
      lines.push(
        `  listAndCount${plural}(filters?: Partial<${name}Entity>, config?: ServiceConfig): Promise<[${name}Entity[], number]>`,
      )
      lines.push(
        `  create${plural}(data: Partial<${name}Entity> | Partial<${name}Entity>[]): Promise<${name}Entity | ${name}Entity[]>`,
      )
      lines.push(
        `  update${plural}(data: (Partial<${name}Entity> & { id: string }) | (Partial<${name}Entity> & { id: string })[]): Promise<${name}Entity | ${name}Entity[]>`,
      )
      lines.push(`  delete${plural}(ids: string | string[]): Promise<void>`)
      lines.push(`  softDelete${plural}(ids: string | string[]): Promise<Record<string, string[]>>`)
      lines.push(`  restore${plural}(ids: string | string[]): Promise<void>`)
      lines.push(`  list(): Promise<${name}Entity[]>`)
      lines.push(`  findById(id: string): Promise<${name}Entity | null>`)

      for (const method of entry.customMethods) {
        lines.push(`  ${method}(...args: unknown[]): Promise<unknown>`)
      }
    }

    // Add shorthand methods for step.service proxy (create, update, delete)
    // These match what createModuleProxy exposes at runtime
    if (moduleEntries.length > 0) {
      const first = moduleEntries[0]
      const name = first.entityName
      lines.push(`  /** Shorthand: step.service.${moduleName}.create(data) */`)
      lines.push(`  create(data: Partial<${name}Entity>): Promise<${name}Entity>`)
      lines.push(`  /** Shorthand: step.service.${moduleName}.update(id, data) */`)
      lines.push(`  update(id: string, data?: Partial<${name}Entity>): Promise<${name}Entity>`)
      lines.push(`  /** Shorthand: step.service.${moduleName}.delete(id) */`)
      lines.push(`  delete(id: string): Promise<void>`)
    }

    lines.push('}')
    lines.push('')
  }

  // ── Build event map ─────────────────────────────────────────────────

  const eventMap = new Map<string, string>()

  // Auto-generated CRUD events from entities (skip external — they have no local CRUD)
  for (const entry of entries) {
    if (entry.isExternal) continue
    const lower = entry.entityName.toLowerCase()
    eventMap.set(`${lower}.created`, '{ id: string }')
    eventMap.set(`${lower}.updated`, '{ id: string }')
    eventMap.set(`${lower}.deleted`, '{ id: string }')
  }

  // Explicit events from commands/subscribers
  for (const event of events) {
    if (!eventMap.has(event.eventName)) {
      if (event.dataFields && Object.keys(event.dataFields).length > 0) {
        const fields = Object.entries(event.dataFields)
          .map(([k, t]) => `${k}: ${t}`)
          .join('; ')
        eventMap.set(event.eventName, `{ ${fields} }`)
      } else {
        eventMap.set(event.eventName, 'Record<string, unknown>')
      }
    }
  }

  const sortedEvents = [...eventMap.keys()].sort()

  // ── Collect commands ────────────────────────────────────────────────

  const commandNames = resources.commands.map((c) => c.id).sort()
  const commandEntries: Array<{ kebab: string; camel: string }> = []
  for (const cmd of resources.commands) {
    const camel = cmd.id.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase())
    assertSafeIdentifierComponent(camel, 'camelCase', `defineCommand in ${cmd.path}`)
    commandEntries.push({ kebab: cmd.id, camel })
  }

  // ── Collect actors ──────────────────────────────────────────────────

  const actorSet = new Set<string>(['user'])
  for (const ctxInfo of resources.contexts) {
    try {
      const ctxMod = (await import(`${ctxInfo.path}?t=${Date.now()}`)) as Record<string, unknown>
      const def = ctxMod.default as { actors?: string | string[] } | undefined
      if (def?.actors) {
        const actors = Array.isArray(def.actors) ? def.actors : [def.actors]
        for (const a of actors) {
          assertSafeIdentifierComponent(a, 'camelCase', `defineContext actor in ${ctxInfo.path}`)
          actorSet.add(a)
        }
      }
    } catch (err) {
      if (MantaError.is(err)) throw err
      console.warn(`  [codegen] Warning: failed to import context '${ctxInfo.id}': ${(err as Error).message}`)
    }
  }
  const sortedActors = [...actorSet].sort()

  // ── Deduplicated module names ───────────────────────────────────────

  const moduleNames = [...new Set(entries.map((e) => e.moduleName))].sort()

  // ── declare global block ────────────────────────────────────────────

  lines.push('declare global {')

  // MantaGeneratedEntities — camelCase keys only
  lines.push('  interface MantaGeneratedEntities {')
  const seenEntityKeys = new Set<string>()
  const entityTypeRef = (entry: ModuleEntry) => {
    const isUser = (entry as any).isUserModel
    return isUser ? `typeof ${entry.entityExportName}['model']` : `typeof ${entry.entityExportName}`
  }
  // Entity keys: camelCase derived from PascalCase entity name
  for (const entry of entries) {
    const camel = entry.entityName.charAt(0).toLowerCase() + entry.entityName.slice(1)
    if (!seenEntityKeys.has(camel)) {
      lines.push(`    ${camel}: ${entityTypeRef(entry)}`)
      seenEntityKeys.add(camel)
    }
  }
  // Module name aliases (only if different from entity camelCase)
  for (const [modName, modEntries] of moduleMap) {
    if (!seenEntityKeys.has(modName)) {
      lines.push(`    ${modName}: ${entityTypeRef(modEntries[0])}`)
      seenEntityKeys.add(modName)
    }
  }
  lines.push('  }')
  lines.push('')

  // MantaGeneratedEntityRegistry — camelCase keys only
  lines.push('  interface MantaGeneratedEntityRegistry {')
  for (const entry of entries) {
    const camel = entry.entityName.charAt(0).toLowerCase() + entry.entityName.slice(1)
    lines.push(`    ${camel}: ${entityTypeRef(entry)}`)
  }
  lines.push('  }')
  lines.push('')

  // MantaGeneratedCommands — includes explicit commands + auto-generated CRUD + link/unlink
  // All names are camelCase for ergonomic step.command.xxx() usage.
  {
    /** Convert any casing to camelCase: 'CustomerGroup' → 'customerGroup', 'customer_group' → 'customerGroup' */
    const toCamel = (name: string) =>
      name
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/[\s_]+/g, '-')
        .toLowerCase()
        .replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase())

    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

    lines.push('  interface MantaGeneratedCommands {')

    // Explicit commands (from src/commands/)
    for (const cmd of commandEntries) {
      if (cmd.kebab === 'graph') continue
      lines.push(`    ${cmd.camel}(input: unknown): Promise<unknown>`)
    }

    // Auto-generated CRUD commands per entity (camelCase)
    for (const entry of entries) {
      const camel = toCamel(entry.entityName)
      const cap = capitalize(camel)
      const capPlural = pluralize(cap)
      lines.push(`    create${cap}(input: Record<string, unknown>): Promise<unknown>`)
      lines.push(`    update${cap}(input: { id: string } & Record<string, unknown>): Promise<unknown>`)
      lines.push(`    delete${cap}(input: { id: string }): Promise<{ id: string; deleted: true }>`)
      lines.push(`    retrieve${cap}(input: { id: string }): Promise<unknown>`)
      lines.push(
        `    list${capPlural}(input?: { filters?: Record<string, unknown>; limit?: number; offset?: number }): Promise<unknown[]>`,
      )
    }

    // Auto-generated link/unlink commands (camelCase)
    const emitLinkTypes = (link: { leftEntity?: string; rightEntity?: string; leftFk?: string; rightFk?: string }) => {
      if (!link?.leftEntity || !link?.rightEntity) return
      const leftCap = capitalize(toCamel(link.leftEntity))
      const rightCap = capitalize(toCamel(link.rightEntity))
      const leftFk = link.leftFk ?? `${toCamel(link.leftEntity)}_id`
      const rightFk = link.rightFk ?? `${toCamel(link.rightEntity)}_id`
      lines.push(
        `    link${leftCap}${rightCap}(input: { ${leftFk}: string; ${rightFk}: string }): Promise<{ success: true }>`,
      )
      lines.push(
        `    unlink${leftCap}${rightCap}(input: { ${leftFk}: string; ${rightFk}: string }): Promise<{ success: true }>`,
      )
    }

    for (const linkInfo of resources.links) {
      try {
        const mod = (await import(`${linkInfo.path}?t=${Date.now()}`)) as Record<string, unknown>
        const link = (mod.default ?? mod) as {
          leftEntity?: string
          rightEntity?: string
          leftFk?: string
          rightFk?: string
          isDirectFk?: boolean
        }
        if (!link?.isDirectFk) emitLinkTypes(link)
      } catch {
        /* skip */
      }
    }
    for (const modInfo of resources.modules) {
      for (const linkInfo of modInfo.intraLinks) {
        try {
          const mod = (await import(`${linkInfo.path}?t=${Date.now()}`)) as Record<string, unknown>
          const link = (mod.default ?? mod) as {
            leftEntity?: string
            rightEntity?: string
            leftFk?: string
            rightFk?: string
            cardinality?: string
            isDirectFk?: boolean
          }
          if (link?.cardinality === 'M:N' && !link?.isDirectFk) emitLinkTypes(link)
        } catch {
          /* skip */
        }
      }
    }

    lines.push('  }')
    lines.push('')
  }

  // MantaGeneratedQueries
  if (resources.queries.length > 0) {
    lines.push('  interface MantaGeneratedQueries {')
    for (const q of resources.queries) {
      if (q.id === 'graph') continue // skip defineQueryGraph entries
      const _camel = q.id.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase())
      lines.push(`    '${q.id}': (params?: Record<string, unknown>) => Promise<unknown>`)
    }
    lines.push('  }')
    lines.push('')
  }

  // MantaGeneratedAgents
  if (agentEntries.length > 0) {
    lines.push('  interface MantaGeneratedAgents {')
    for (const agent of agentEntries) {
      lines.push(
        `    ${agent.camel}(input: z.infer<typeof ${agent.camel}Def.input>): Promise<z.infer<typeof ${agent.camel}Def.output>>`,
      )
    }
    lines.push('  }')
    lines.push('')
  }

  // MantaGeneratedEventMap
  lines.push('  /** Event data map — typed event.data for defineSubscriber() and step.emit(). */')
  lines.push('  interface MantaGeneratedEventMap {')
  for (const name of sortedEvents) {
    lines.push(`    '${name}': ${eventMap.get(name)}`)
  }
  lines.push('  }')
  lines.push('')

  // DefineSubscriberFn — merge event-specific overloads for autocomplete
  // Interface call signatures with explicit string literals give IDE autocomplete.
  if (sortedEvents.length > 0) {
    lines.push('  /** Codegen overloads — gives autocomplete for event names in defineSubscriber(). */')
    lines.push('  interface DefineSubscriberFn {')
    for (const name of sortedEvents) {
      const dataType = eventMap.get(name)!
      lines.push(
        `    (event: '${name}', handler: (event: import('@manta/core').Message<${dataType}>, scope: import('@manta/core').SubscriberScope) => void | Promise<void>): import('@manta/core').SubscriberDefinition<${dataType}> & { __type: 'subscriber' }`,
      )
    }
    lines.push('  }')
    lines.push('')
  }

  // MantaGeneratedAppModules (deduplicated — one entry per module)
  lines.push('  interface MantaGeneratedAppModules {')
  for (const moduleName of moduleNames) {
    lines.push(`    ${moduleName}: ${moduleName}Module`)
  }
  lines.push('  }')
  lines.push('')

  // MantaGeneratedRegistry (deduplicated module names)
  lines.push('  interface MantaGeneratedRegistry {')
  if (moduleNames.length > 0) {
    lines.push('    modules: {')
    for (const name of moduleNames) {
      lines.push(`      ${name}: true`)
    }
    lines.push('    }')
  }
  if (commandNames.length > 0) {
    lines.push('    commands: {')
    for (const name of commandNames) {
      lines.push(`      '${name}': true`)
    }
    lines.push('    }')
  }
  if (sortedActors.length > 0) {
    lines.push('    actors: {')
    for (const actor of sortedActors) {
      lines.push(`      ${actor}: true`)
    }
    lines.push('    }')
  }
  lines.push('  }')

  lines.push('}')
  lines.push('')
  lines.push('export {}')
  lines.push('')

  const source = lines.join('\n')
  validateGeneratedTypeScript(source, 'generated.d.ts')
  writeFileSync(outPath, source)

  // ── Generate command schemas for frontend (runtime metadata) ────────
  await generateCommandSchemas(cwd, resources, mantaDir)

  console.log(
    `  [codegen] .manta/generated.d.ts (${entries.length} entities, ${commandNames.length} commands, ${agentEntries.length} agents, ${sortedActors.length} actors, ${sortedEvents.length} events)`,
  )
}

// ── Command schema extraction for frontend forms ─────────────────────

interface FieldMeta {
  key: string
  required: boolean
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'array' | 'object' | 'unknown'
  checks?: string[] // e.g. ['email', 'url', 'min:3']
  options?: string[] // for enums
}

/**
 * Extract field metadata from a Zod schema (introspects _def).
 */
function extractZodFields(schema: unknown): FieldMeta[] {
  const fields: FieldMeta[] = []
  // biome-ignore lint/suspicious/noExplicitAny: Zod internal structure
  const s = schema as any
  if (!s?._def?.typeName) return fields

  // Must be a ZodObject
  if (s._def.typeName !== 'ZodObject') return fields

  const shape = s._def.shape?.() ?? s._def.shape ?? {}

  for (const [key, fieldSchema] of Object.entries(shape)) {
    // biome-ignore lint/suspicious/noExplicitAny: Zod internal
    let inner = fieldSchema as any
    let required = true

    // Unwrap ZodOptional / ZodDefault
    while (inner?._def) {
      if (inner._def.typeName === 'ZodOptional' || inner._def.typeName === 'ZodNullable') {
        required = false
        inner = inner._def.innerType
      } else if (inner._def.typeName === 'ZodDefault') {
        required = false
        inner = inner._def.innerType
      } else {
        break
      }
    }

    const typeName = inner?._def?.typeName ?? ''
    let type: FieldMeta['type'] = 'unknown'
    const checks: string[] = []
    let options: string[] | undefined

    switch (typeName) {
      case 'ZodString':
        type = 'string'
        // Extract string checks (email, url, min, max, etc.)
        for (const check of inner._def.checks ?? []) {
          if (check.kind === 'email') checks.push('email')
          else if (check.kind === 'url') checks.push('url')
          else if (check.kind === 'min') checks.push(`min:${check.value}`)
          else if (check.kind === 'max') checks.push(`max:${check.value}`)
        }
        break
      case 'ZodNumber':
        type = 'number'
        for (const check of inner._def.checks ?? []) {
          if (check.kind === 'min') checks.push(`min:${check.value}`)
          else if (check.kind === 'max') checks.push(`max:${check.value}`)
          else if (check.kind === 'int') checks.push('int')
        }
        break
      case 'ZodBoolean':
        type = 'boolean'
        break
      case 'ZodDate':
        type = 'date'
        break
      case 'ZodEnum':
      case 'ZodNativeEnum':
        type = 'enum'
        options = inner._def.values
        break
      case 'ZodArray':
        type = 'array'
        break
      default:
        type = 'unknown'
    }

    fields.push({ key, required, type, checks: checks.length > 0 ? checks : undefined, options })
  }

  return fields
}

/**
 * Generate .manta/command-schemas.ts — runtime metadata for frontend form validation.
 */
async function generateCommandSchemas(
  _cwd: string,
  resources: Awaited<ReturnType<typeof discoverResources>>,
  mantaDir: string,
): Promise<void> {
  const schemas: Record<string, FieldMeta[]> = {}

  for (const cmdInfo of resources.commands) {
    try {
      const mod = (await import(`${cmdInfo.path}?t=${Date.now()}`)) as Record<string, unknown>
      const cmd = mod.default as { name?: string; input?: unknown } | undefined
      if (!cmd?.name || !cmd?.input) continue

      const fields = extractZodFields(cmd.input)
      if (fields.length > 0) {
        schemas[cmd.name] = fields
      }
    } catch {
      // Command may not be importable — skip
    }
  }

  if (Object.keys(schemas).length === 0) return

  const outPath = resolve(mantaDir, 'command-schemas.ts')
  const content = [
    '// Auto-generated by manta dev — DO NOT EDIT',
    '// Command input schemas for frontend form validation.',
    '',
    `export const commandSchemas: Record<string, Array<{ key: string; required: boolean; type: string; checks?: string[]; options?: string[] }>> = ${JSON.stringify(schemas, null, 2)}`,
    '',
  ].join('\n')

  validateGeneratedTypeScript(content, 'command-schemas.ts')
  writeFileSync(outPath, content)
}
