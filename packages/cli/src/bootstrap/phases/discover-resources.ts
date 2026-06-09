// Phase 2: Discover resources — app + plugins (Nuxt Layers style).

import type { DiscoveredResources } from '../../resource-loader'
import type { BootstrapContext } from '../bootstrap-context'

export async function discoverResourcesPhase(ctx: BootstrapContext): Promise<void> {
  const { logger, options, config, cwd } = ctx

  // When preloadedResources is provided (from build-time manifest), skip ALL filesystem
  // discovery and plugin resolution.
  let resources: DiscoveredResources
  let resolvedPlugins: Array<{ name: string; rootDir: string }> = []

  if (options.preloadedResources) {
    logger.info('Using pre-loaded resources (build-time manifest)')
    resources = options.preloadedResources

    // Merge plugin resources into the main resources (modules, commands, queries, etc.)
    if (options.preloadedPluginResources?.length) {
      resources = mergePreloadedResources([...options.preloadedPluginResources.map((p) => p.resources), resources])
      logger.info(`  Plugins (preloaded): ${options.preloadedPluginResources.map((p) => p.name).join(', ')}`)
    }
  } else {
    logger.info('Discovering resources...')
    const { discoverResources } = await import('../../resource-loader')
    const { resolvePlugins } = await import('../../plugins/resolve-plugins')
    const { mergePluginResources } = await import('../../plugins/merge-resources')

    resolvedPlugins = resolvePlugins(config, cwd)
    if (resolvedPlugins.length > 0) {
      logger.info(`  Plugins: ${resolvedPlugins.map((p) => p.name).join(', ')}`)
    }

    const appResources = await discoverResources(cwd)
    resources = await mergePluginResources(resolvedPlugins, appResources)
  }

  ctx.resources = resources
  ctx.resolvedPlugins = resolvedPlugins

  // [6b] Pre-load table generation utilities
  const { generatePgTableFromDml, generateLinkPgTable } = await import('@manta/adapter-database-pg')
  ctx.generatePgTableFromDml = generatePgTableFromDml
  ctx.generateLinkPgTable = generateLinkPgTable
}

function mergePreloadedResources(layers: DiscoveredResources[]): DiscoveredResources {
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
    middlewares: layers.reduceRight(
      (acc, layer) => acc ?? layer.middlewares,
      null as DiscoveredResources['middlewares'],
    ),
  }
}

function deduplicateBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const map = new Map<string, T>()
  for (const item of items) {
    map.set(keyFn(item), item)
  }
  return Array.from(map.values())
}
