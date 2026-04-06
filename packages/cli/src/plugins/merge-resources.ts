// Plugin resource merging — Nuxt Layers style
// Discovers resources from each plugin, merges with app resources.
// Precedence: last entry wins → local app always overrides plugins.

import type { DiscoveredResources } from '../resource-loader'
import { discoverResources } from '../resource-loader'
import type { DiscoveredRoute } from '../route-discovery'
import { discoverRoutes } from '../route-discovery'
import type { ResolvedPlugin } from './resolve-plugins'

/**
 * Discover resources from all plugins and merge with app resources.
 * Order: plugins (in order, lowest → highest priority), then app (highest priority).
 * Deduplication: last entry with the same key wins.
 */
export async function mergePluginResources(
  plugins: ResolvedPlugin[],
  appResources: DiscoveredResources,
): Promise<DiscoveredResources> {
  if (plugins.length === 0) return appResources

  // Discover resources from each plugin
  const allLayers: DiscoveredResources[] = []
  for (const plugin of plugins) {
    const pluginResources = await discoverResources(plugin.rootDir)
    allLayers.push(pluginResources)
  }

  // App resources come last (highest priority)
  allLayers.push(appResources)

  return mergeLayers(allLayers)
}

/**
 * Discover API routes from all plugins and the app, merged with deduplication.
 */
export async function mergePluginApiRoutes(plugins: ResolvedPlugin[], cwd: string): Promise<DiscoveredRoute[]> {
  const allRoutes: DiscoveredRoute[] = []

  // Plugin routes first (lowest priority)
  for (const plugin of plugins) {
    const routes = await discoverRoutes(plugin.rootDir)
    allRoutes.push(...routes)
  }

  // App routes last (highest priority)
  const appRoutes = await discoverRoutes(cwd)
  allRoutes.push(...appRoutes)

  // Deduplicate by method + path (last wins = app wins)
  return deduplicateBy(allRoutes, (r) => `${r.method}:${r.path}`)
}

// ── Merge logic ───────────────────────────────────────────────��─────

function mergeLayers(layers: DiscoveredResources[]): DiscoveredResources {
  return {
    modules: deduplicateBy(
      layers.flatMap((l) => l.modules),
      (m) => m.name,
    ),
    subscribers: deduplicateBy(
      layers.flatMap((l) => l.subscribers),
      (s) => s.id,
    ),
    workflows: deduplicateBy(
      layers.flatMap((l) => l.workflows),
      (w) => w.id,
    ),
    jobs: deduplicateBy(
      layers.flatMap((l) => l.jobs),
      (j) => j.id,
    ),
    links: deduplicateBy(
      layers.flatMap((l) => l.links),
      (l) => l.id,
    ),
    commands: deduplicateBy(
      layers.flatMap((l) => l.commands),
      (c) => `${c.context ?? ''}:${c.id}`,
    ),
    queries: deduplicateBy(
      layers.flatMap((l) => l.queries),
      (q) => `${q.context}:${q.id}`,
    ),
    users: deduplicateBy(
      layers.flatMap((l) => l.users),
      (u) => u.contextName,
    ),
    contexts: deduplicateBy(
      layers.flatMap((l) => l.contexts),
      (c) => c.id,
    ),
    agents: deduplicateBy(
      layers.flatMap((l) => l.agents),
      (a) => a.id,
    ),
    spas: deduplicateBy(
      layers.flatMap((l) => l.spas),
      (s) => s.name,
    ),
    contextMiddlewares: deduplicateBy(
      layers.flatMap((l) => l.contextMiddlewares),
      (m) => m.context,
    ),
    // Singular: last layer with a value wins
    middlewares: layers.reduceRight((acc, l) => acc ?? l.middlewares, null as DiscoveredResources['middlewares']),
  }
}

/**
 * Deduplicate array by key function. Last entry with the same key wins.
 * This ensures: plugins < app (since app entries are appended last).
 */
function deduplicateBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const map = new Map<string, T>()
  for (const item of items) {
    map.set(keyFn(item), item)
  }
  return Array.from(map.values())
}
