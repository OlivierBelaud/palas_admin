// SPEC-074 — ResourceLoader: filesystem-based resource discovery
// Scans project directory for modules, subscribers, workflows, jobs, links, middlewares
// Modules are discovered via entities/{name}/model.ts — no index.ts needed.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { MantaError } from '@manta/core'

export interface DiscoveredEntity {
  /** Entity directory name (e.g. 'post', 'category') */
  name: string
  /** Absolute path to model.ts */
  modelPath: string
  /** Absolute path to service.ts (undefined if no custom service) */
  servicePath: string | undefined
}

export interface DiscoveredModule {
  /** Module directory name (e.g. 'blog', 'inventory') */
  name: string
  /** Absolute path to the module directory */
  moduleDir: string
  /** Discovered entities within this module */
  entities: DiscoveredEntity[]
  /** Intra-module commands (modules/{name}/commands/*.ts) — commands scoped to this module */
  commands: DiscoveredCommand[]
  /** Intra-module queries (modules/{name}/queries/*.ts) — queries scoped to this module */
  queries: DiscoveredCommand[]
  /** Intra-module raw API routes (modules/{name}/api/**\/route.ts) — escape hatch for non-CQRS cases like proxies */
  apiRoutes: DiscoveredModuleRoute[]
  /** Intra-module links (modules/{name}/links/*.ts) */
  intraLinks: DiscoveredLink[]
  /**
   * Primary entity model path — first entity's model.ts.
   * @deprecated Use entities[] instead for multi-entity support.
   */
  path: string
  models: string[]
  service: string
}

export interface DiscoveredModuleRoute {
  /** Relative path under the module's api/ directory (e.g. "[...path]" or "webhook/stripe") */
  relativePath: string
  /** Absolute path to the route.ts file */
  file: string
}

export interface DiscoveredSubscriber {
  id: string
  path: string
  events: string[]
}

export interface DiscoveredWorkflow {
  id: string
  path: string
}

export interface DiscoveredJob {
  id: string
  path: string
  schedule?: string
}

export interface DiscoveredLink {
  id: string
  path: string
  modules: string[]
}

export interface DiscoveredCommand {
  id: string
  path: string
  /** V2: context name derived from parent folder (e.g. 'admin'). Undefined for V1 flat commands. */
  context?: string
}

export interface DiscoveredQuery {
  id: string
  path: string
  /** Context name derived from parent folder (e.g. 'admin'). */
  context: string
}

export interface DiscoveredUser {
  /** Context name (e.g. 'admin', 'vendor'). */
  contextName: string
  /** Module directory name (e.g. 'admin-user'). */
  moduleName: string
  /** Absolute path to the defineUserModel file. */
  path: string
}

export interface DiscoveredContextMiddleware {
  /** Context name (e.g. 'admin'). */
  context: string
  /** Absolute path to the middleware file. */
  path: string
}

export interface DiscoveredSpaPage {
  /** Route path (e.g. '/products', '/products/[id]'). */
  route: string
  /** Absolute path to the page.tsx file. */
  path: string
}

export interface DiscoveredBlock {
  /** Block type name in PascalCase (e.g. 'InventoryMatrix'). */
  type: string
  /** Absolute path to the block file. */
  path: string
}

export interface DiscoveredSpa {
  /** SPA name (directory name, e.g. 'admin', 'vendor'). */
  name: string
  /** Absolute path to the SPA directory. */
  path: string
  /** Auto-discovered pages from page.tsx files. */
  pages: DiscoveredSpaPage[]
  /** Auto-discovered custom blocks from blocks/ directory. */
  blocks: DiscoveredBlock[]
  /** Path to config.ts if it exists (defineSpa() configuration). */
  configPath: string | null
}

export interface DiscoveredContext {
  id: string
  path: string
}

export interface DiscoveredAgent {
  id: string
  path: string
}

export interface DiscoveredResources {
  modules: DiscoveredModule[]
  subscribers: DiscoveredSubscriber[]
  workflows: DiscoveredWorkflow[]
  jobs: DiscoveredJob[]
  links: DiscoveredLink[]
  commands: DiscoveredCommand[]
  /** V2: queries discovered from src/queries/{context}/*.ts */
  queries: DiscoveredQuery[]
  /** V2: user definitions discovered from modules with defineUserModel() */
  users: DiscoveredUser[]
  contexts: DiscoveredContext[]
  agents: DiscoveredAgent[]
  middlewares: { path: string } | null
  /** V2: per-context middleware overrides from src/middleware/{context}.ts */
  contextMiddlewares: DiscoveredContextMiddleware[]
  /** V2: SPAs discovered from src/spa/{name}/ */
  spas: DiscoveredSpa[]
}

/**
 * Discover all resources in a project directory.
 * Scans src/modules, src/subscribers, src/workflows, src/jobs, src/links, src/middlewares.ts
 */
export async function discoverResources(projectRoot: string): Promise<DiscoveredResources> {
  const srcDir = resolve(projectRoot, 'src')

  const result: DiscoveredResources = {
    modules: [],
    subscribers: [],
    workflows: [],
    jobs: [],
    links: [],
    commands: [],
    queries: [],
    users: [],
    contexts: [],
    agents: [],
    middlewares: null,
    contextMiddlewares: [],
    spas: [],
  }

  if (!existsSync(srcDir)) {
    return result
  }

  // Modules: src/modules/*/entities/*/model.ts (file-based, no index.ts needed)
  result.modules = discoverModules(srcDir)

  // Subscribers: src/subscribers/*.ts
  result.subscribers = discoverTsFiles(resolve(srcDir, 'subscribers'), (name, path) => ({
    id: name,
    path,
    events: [], // populated at import time during boot
  }))

  // Workflows: src/workflows/*.ts
  result.workflows = discoverTsFiles(resolve(srcDir, 'workflows'), (name, path) => ({
    id: name,
    path,
  }))

  // Jobs: src/jobs/*.ts
  result.jobs = discoverTsFiles(resolve(srcDir, 'jobs'), (name, path) => ({
    id: name,
    path,
  }))

  // Links: src/links/*.ts
  result.links = discoverTsFiles(resolve(srcDir, 'links'), (name, path) => ({
    id: name,
    path,
    modules: [], // populated at import time during boot
  }))

  // Commands: src/commands/*.ts (V1 flat) + src/commands/{context}/*.ts (V2 nested)
  result.commands = discoverCommandsV2(srcDir)

  // Queries: src/queries/{context}/*.ts (V2 only)
  result.queries = discoverQueries(srcDir)

  // Users: modules whose index.ts exports a defineUserModel() result
  result.users = discoverUsers(result.modules, resolve(srcDir, 'modules'))

  // Per-context middleware: src/middleware/{context}.ts (V2)
  result.contextMiddlewares = discoverContextMiddlewares(srcDir)

  // SPAs: src/spa/{name}/ (V2)
  result.spas = discoverSpas(srcDir)

  // Contexts: src/contexts/*.ts
  result.contexts = discoverTsFiles(resolve(srcDir, 'contexts'), (name, path) => ({
    id: name,
    path,
  }))

  // Agents: src/agents/*.ts
  result.agents = discoverTsFiles(resolve(srcDir, 'agents'), (name, path) => ({
    id: name,
    path,
  }))

  // Middlewares: src/middlewares.ts
  const middlewaresPath = resolve(srcDir, 'middlewares.ts')
  if (existsSync(middlewaresPath)) {
    result.middlewares = { path: middlewaresPath }
  }

  return result
}

/**
 * Discover modules from src/modules/{name}/entities/{entity}/model.ts
 * No index.ts required — entities are discovered directly from file structure.
 *
 * Structure:
 *   modules/{module}/entities/{entity}/model.ts    — required
 *   modules/{module}/entities/{entity}/service.ts  — optional
 */
function discoverModules(srcDir: string): DiscoveredModule[] {
  const modulesDir = resolve(srcDir, 'modules')
  if (!existsSync(modulesDir)) return []

  const modules: DiscoveredModule[] = []

  for (const entry of readdirSync(modulesDir)) {
    const moduleDir = resolve(modulesDir, entry)
    if (!statSync(moduleDir).isDirectory()) continue

    // Validate structure — reject model.ts/service.ts at module root
    validateModuleStructure(moduleDir, entry)

    // Discover entities from entities/*/model.ts
    const entities = discoverEntities(moduleDir, entry)
    if (entities.length === 0) continue // Skip modules with no entities

    // Discover intra-module commands from commands/*.ts (commands scoped to this module)
    const moduleCommands = discoverTsFiles(resolve(moduleDir, 'commands'), (name, path) => ({
      id: name,
      path,
    }))

    // Discover intra-module queries from queries/*.ts (queries scoped to this module)
    const moduleQueries = discoverTsFiles(resolve(moduleDir, 'queries'), (name, path) => ({
      id: name,
      path,
    }))

    // Discover intra-module raw API routes from api/**/route.ts (escape hatch for non-CQRS)
    const moduleApiRoutes = discoverModuleApiRoutes(resolve(moduleDir, 'api'))

    // Discover intra-module links from links/*.ts
    const moduleLinks = discoverTsFiles(resolve(moduleDir, 'links'), (name, path) => ({
      id: name,
      path,
      modules: [entry],
    }))

    // Module name = directory name
    const name = entry

    // Service name convention: capitalize + "Service"
    const service = `${name.charAt(0).toUpperCase()}${name.slice(1).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}Service`

    modules.push({
      name,
      moduleDir,
      entities,
      commands: moduleCommands,
      queries: moduleQueries,
      apiRoutes: moduleApiRoutes,
      intraLinks: moduleLinks,
      // Backward compat: path = first entity's model.ts
      path: entities[0].modelPath,
      models: entities.map((e) => e.name),
      service,
    })
  }

  return modules
}

/**
 * Discover entities within a module's entities/ directory.
 * Each entity must have model.ts. service.ts is optional.
 */
function discoverEntities(moduleDir: string, moduleName: string): DiscoveredEntity[] {
  const entitiesDir = resolve(moduleDir, 'entities')
  if (!existsSync(entitiesDir)) return []

  const entities: DiscoveredEntity[] = []

  for (const entityEntry of readdirSync(entitiesDir)) {
    const entityDir = resolve(entitiesDir, entityEntry)
    if (!statSync(entityDir).isDirectory()) {
      throw new MantaError(
        'INVALID_DATA',
        `Module "${moduleName}": entities/ must contain only directories (one per entity). ` +
          `Found file "${entityEntry}" directly in entities/. ` +
          `Move it to modules/${moduleName}/entities/${entityEntry.replace(/\.ts$/, '')}/model.ts`,
      )
    }

    const modelPath = resolve(entityDir, 'model.ts')
    if (!existsSync(modelPath)) {
      throw new MantaError(
        'INVALID_DATA',
        `Module "${moduleName}": entity "${entityEntry}" is missing model.ts. ` +
          `Every entity directory must contain a model.ts file with a defineModel() call.`,
      )
    }

    const servicePath = resolve(entityDir, 'service.ts')

    entities.push({
      name: entityEntry,
      modelPath,
      servicePath: existsSync(servicePath) ? servicePath : undefined,
    })
  }

  return entities
}

/**
 * Validate that a module follows the canonical structure.
 * Rejects model.ts or service.ts at module root — they must be in entities/{entity}/.
 */
function validateModuleStructure(moduleDir: string, moduleName: string): void {
  const rootModel = resolve(moduleDir, 'model.ts')
  const rootService = resolve(moduleDir, 'service.ts')

  if (existsSync(rootModel)) {
    throw new MantaError(
      'INVALID_DATA',
      `Module "${moduleName}" has model.ts at its root. ` +
        `Move it to modules/${moduleName}/entities/{entity-name}/model.ts — ` +
        `the framework requires entities to be in the entities/ subdirectory.`,
    )
  }

  if (existsSync(rootService)) {
    throw new MantaError(
      'INVALID_DATA',
      `Module "${moduleName}" has service.ts at its root. ` +
        `Move it to modules/${moduleName}/entities/{entity-name}/service.ts — ` +
        `each entity's service belongs next to its model.`,
    )
  }
}

/**
 * Discover raw API route files in a module's api/ directory.
 * Recursively walks the directory looking for route.ts files.
 *
 * Example:
 *   modules/posthog/api/[...path]/route.ts       → relativePath "[...path]"
 *   modules/stripe/api/webhook/route.ts          → relativePath "webhook"
 *   modules/stripe/api/oauth/callback/route.ts   → relativePath "oauth/callback"
 */
function discoverModuleApiRoutes(apiDir: string): DiscoveredModuleRoute[] {
  if (!existsSync(apiDir)) return []

  const routes: DiscoveredModuleRoute[] = []

  const walk = (dir: string, relParts: string[]): void => {
    for (const entry of readdirSync(dir)) {
      const fullPath = resolve(dir, entry)
      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        walk(fullPath, [...relParts, entry])
      } else if (entry === 'route.ts' || entry === 'route.js') {
        routes.push({
          relativePath: relParts.join('/'),
          file: fullPath,
        })
      }
    }
  }

  walk(apiDir, [])
  return routes
}

/**
 * Generic discovery for .ts files in a directory.
 * Returns T[] where T is built from (baseName, absolutePath).
 */
function discoverTsFiles<T>(dir: string, mapFn: (name: string, path: string) => T): T[] {
  if (!existsSync(dir)) return []

  const results: T[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue
    const filePath = resolve(dir, file)
    if (!statSync(filePath).isFile()) continue
    const name = basename(file, file.endsWith('.ts') ? '.ts' : '.js')
    results.push(mapFn(name, filePath))
  }
  return results
}

// ── V2 Discovery Functions ──────────────────────────────────────────

/**
 * V2: Discover commands from both flat (V1) and nested (V2) patterns.
 * - src/commands/*.ts → V1 flat commands (no context)
 * - src/commands/{context}/*.ts → V2 context-scoped commands
 */
function discoverCommandsV2(srcDir: string): DiscoveredCommand[] {
  const commandsDir = resolve(srcDir, 'commands')
  if (!existsSync(commandsDir)) return []

  const commands: DiscoveredCommand[] = []

  for (const entry of readdirSync(commandsDir)) {
    const entryPath = resolve(commandsDir, entry)

    if (statSync(entryPath).isDirectory()) {
      // V2 nested: commands/{context}/*.ts
      const contextName = entry
      const contextCommands = discoverTsFiles(entryPath, (name, path) => ({
        id: name,
        path,
        context: contextName,
      }))
      commands.push(...contextCommands)
    } else if (entry.endsWith('.ts') || entry.endsWith('.js')) {
      // V1 flat: commands/*.ts
      const name = basename(entry, entry.endsWith('.ts') ? '.ts' : '.js')
      commands.push({ id: name, path: entryPath })
    }
  }

  return commands
}

/**
 * V2: Discover queries from src/queries/{context}/*.ts.
 * Queries are always context-scoped (no flat pattern).
 */
function discoverQueries(srcDir: string): DiscoveredQuery[] {
  const queriesDir = resolve(srcDir, 'queries')
  if (!existsSync(queriesDir)) return []

  const queries: DiscoveredQuery[] = []

  for (const entry of readdirSync(queriesDir)) {
    const contextDir = resolve(queriesDir, entry)
    if (!statSync(contextDir).isDirectory()) continue

    const contextName = entry
    const contextQueries = discoverTsFiles(contextDir, (name, path) => ({
      id: name,
      path,
      context: contextName,
    }))
    queries.push(...contextQueries)
  }

  return queries
}

/**
 * V2: Detect user definitions by checking for index.ts in user module directories.
 * Convention: modules ending with '-user' that export a defineUserModel() result.
 * The actual __type check happens at import time during bootstrap.
 */
/**
 * Detect user definitions in ANY module.
 *
 * defineUserModel can be used instead of defineModel in any entity's model.ts.
 * We scan all model.ts files for the string 'defineUserModel' to identify candidates.
 * The actual __type: 'user' check happens at import time during bootstrap.
 *
 * Also supports legacy convention: modules ending with '-user' that have index.ts.
 */
function discoverUsers(modules: DiscoveredModule[], modulesDir: string): DiscoveredUser[] {
  const users: DiscoveredUser[] = []

  for (const mod of modules) {
    // Scan ALL entity model.ts files for defineUserModel usage
    for (const entity of mod.entities) {
      const modelPath = entity.modelPath
      if (!existsSync(modelPath)) continue

      try {
        const content = readFileSync(modelPath, 'utf-8')
        if (content.includes('defineUserModel')) {
          // Extract context name from the defineUserModel call: defineUserModel('customer', ...)
          const match = content.match(/defineUserModel\s*\(\s*['"]([^'"]+)['"]/)
          const contextName = match?.[1] ?? entity.name.toLowerCase()

          users.push({
            contextName,
            moduleName: mod.name,
            path: modelPath,
          })
        }
      } catch {
        // Can't read file — skip
      }
    }

    // Legacy: modules ending with '-user' that have index.ts
    if (mod.name.endsWith('-user')) {
      const indexPath = resolve(modulesDir, mod.name, 'index.ts')
      if (existsSync(indexPath)) {
        const contextName = mod.name.replace(/-user$/, '')
        // Don't add duplicate if already found via model.ts scan
        if (!users.some((u) => u.contextName === contextName)) {
          users.push({ contextName, moduleName: mod.name, path: indexPath })
        }
      }
    }
  }

  return users
}

/**
 * V2: Discover per-context middleware from src/middleware/{context}.ts.
 * Each .ts file in the middleware/ directory is a context override.
 */
function discoverContextMiddlewares(srcDir: string): DiscoveredContextMiddleware[] {
  const middlewareDir = resolve(srcDir, 'middleware')
  if (!existsSync(middlewareDir)) return []

  const middlewares: DiscoveredContextMiddleware[] = []

  for (const file of readdirSync(middlewareDir)) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue
    const filePath = resolve(middlewareDir, file)
    if (!statSync(filePath).isFile()) continue
    const context = basename(file, file.endsWith('.ts') ? '.ts' : '.js')
    middlewares.push({ context, path: filePath })
  }

  return middlewares
}

/**
 * V2: Discover SPAs from src/spa/{name}/.
 * Each subdirectory in spa/ is a SPA to serve on /{name}.
 */
function discoverSpas(srcDir: string): DiscoveredSpa[] {
  const spaDir = resolve(srcDir, 'spa')
  if (!existsSync(spaDir)) return []

  const spas: DiscoveredSpa[] = []

  for (const entry of readdirSync(spaDir)) {
    const entryPath = resolve(spaDir, entry)
    if (!statSync(entryPath).isDirectory()) continue

    // Discover pages from pages/ subdirectory
    const pagesDir = resolve(entryPath, 'pages')
    const pages = discoverSpaPages(pagesDir, '')
    // Discover custom blocks from blocks/ subdirectory
    const blocks = discoverSpaBlocks(resolve(entryPath, 'blocks'))
    // Discover config.ts
    const configTs = resolve(entryPath, 'config.ts')
    const configPath = existsSync(configTs) ? configTs : null
    spas.push({ name: entry, path: entryPath, pages, blocks, configPath })
  }

  return spas
}

/**
 * Recursively discover page.tsx files in a SPA directory.
 * src/spa/admin/products/page.tsx → route '/products'
 * src/spa/admin/page.tsx → route '/'
 * src/spa/admin/orders/[id]/page.tsx → route '/orders/:id'
 */
function discoverSpaPages(dir: string, prefix: string): DiscoveredSpaPage[] {
  const pages: DiscoveredSpaPage[] = []
  if (!existsSync(dir)) return pages

  for (const entry of readdirSync(dir)) {
    const entryPath = resolve(dir, entry)

    if (entry === 'page.tsx' || entry === 'page.ts') {
      const route = prefix || '/'
      pages.push({ route, path: entryPath })
    } else if (statSync(entryPath).isDirectory()) {
      // Convert [param] to :param for routing
      const segment = entry.startsWith('[') && entry.endsWith(']') ? `:${entry.slice(1, -1)}` : entry
      pages.push(...discoverSpaPages(entryPath, `${prefix}/${segment}`))
    }
  }

  return pages
}

/**
 * Discover custom blocks from a SPA's blocks/ directory.
 * blocks/inventory-matrix.tsx → type 'InventoryMatrix'
 */
function discoverSpaBlocks(dir: string): DiscoveredBlock[] {
  const blocks: DiscoveredBlock[] = []
  if (!existsSync(dir)) return blocks

  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.tsx') && !entry.endsWith('.ts')) continue
    if (entry.startsWith('.') || entry === 'index.ts' || entry === 'index.tsx') continue

    const name = entry.replace(/\.tsx?$/, '')
    // Convert kebab-case to PascalCase
    const type = name
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('')

    blocks.push({ type, path: resolve(dir, entry) })
  }

  return blocks
}
