// Phase 2: Discover resources — app + plugins (Nuxt Layers style).

import { discoverResources } from '../../resource-loader'
import type { BootstrapContext } from '../bootstrap-context'

export async function discoverResourcesPhase(ctx: BootstrapContext): Promise<void> {
  const { logger, options, config, cwd } = ctx

  // When preloadedResources is provided (from build-time manifest), skip ALL filesystem
  // discovery and plugin resolution.
  let resources: Awaited<ReturnType<typeof discoverResources>>
  let resolvedPlugins: Array<{ name: string; rootDir: string }> = []

  if (options.preloadedResources) {
    logger.info('Using pre-loaded resources (build-time manifest)')
    resources = options.preloadedResources

    // Merge plugin resources into the main resources (modules, commands, queries, etc.)
    if (options.preloadedPluginResources?.length) {
      const { mergePluginResources } = await import('../../plugins/merge-resources')
      resources = await mergePluginResources(
        options.preloadedPluginResources.map((p: any) => ({ name: p.name, rootDir: p.rootDir })),
        resources,
        options.preloadedPluginResources,
      )
      logger.info(`  Plugins (preloaded): ${options.preloadedPluginResources.map((p: any) => p.name).join(', ')}`)
    }
  } else {
    logger.info('Discovering resources...')
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
