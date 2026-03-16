// SPEC-074 — ResourceLoader: filesystem-based resource discovery
// Scans project directory for modules, subscribers, workflows, jobs, links, middlewares

import { resolve, basename } from 'node:path'
import { existsSync, readdirSync, statSync } from 'node:fs'

export interface DiscoveredModule {
  name: string
  path: string
  models: string[]
  service: string
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

export interface DiscoveredResources {
  modules: DiscoveredModule[]
  subscribers: DiscoveredSubscriber[]
  workflows: DiscoveredWorkflow[]
  jobs: DiscoveredJob[]
  links: DiscoveredLink[]
  middlewares: { path: string } | null
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
    middlewares: null,
  }

  if (!existsSync(srcDir)) {
    return result
  }

  // Modules: src/modules/*/index.ts
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

  // Middlewares: src/middlewares.ts
  const middlewaresPath = resolve(srcDir, 'middlewares.ts')
  if (existsSync(middlewaresPath)) {
    result.middlewares = { path: middlewaresPath }
  }

  return result
}

// Discover modules from src/modules/*/index.ts
function discoverModules(srcDir: string): DiscoveredModule[] {
  const modulesDir = resolve(srcDir, 'modules')
  if (!existsSync(modulesDir)) return []

  const modules: DiscoveredModule[] = []

  for (const entry of readdirSync(modulesDir)) {
    const moduleDir = resolve(modulesDir, entry)
    if (!statSync(moduleDir).isDirectory()) continue

    const indexPath = resolve(moduleDir, 'index.ts')
    if (!existsSync(indexPath)) continue

    // Discover models within the module
    const models = discoverModelNames(moduleDir)

    // Module name = directory name
    const name = entry

    // Service name convention: capitalize + "Service"
    const service = `${name.charAt(0).toUpperCase()}${name.slice(1).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}Service`

    modules.push({
      name,
      path: indexPath,
      models,
      service,
    })
  }

  return modules
}

/**
 * Discover model file names from a module's models/ directory.
 */
function discoverModelNames(moduleDir: string): string[] {
  const modelsDir = resolve(moduleDir, 'models')
  if (!existsSync(modelsDir)) return []

  const models: string[] = []
  for (const file of readdirSync(modelsDir)) {
    if (file.endsWith('.ts') || file.endsWith('.js')) {
      models.push(basename(file, file.endsWith('.ts') ? '.ts' : '.js'))
    }
  }
  return models
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
