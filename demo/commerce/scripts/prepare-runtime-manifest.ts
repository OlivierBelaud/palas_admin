// Build the same static user-module manifest used by the Vercel preset, then
// let the mandatory Node runtime smoke execute that production import graph.
// Manta's node preset otherwise falls back to jiti filesystem discovery,
// which is a different path and cannot load TSX after Nitro bundles jiti.

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { discoverResources } from '@mantajs/cli/resource-loader'
import { loadConfig } from '@mantajs/cli/config'

const cwd = process.cwd()
const require = createRequire(import.meta.url)
const cliRoot = dirname(require.resolve('@mantajs/cli/package.json'))
const importInternal = (relativePath: string) => import(pathToFileURL(join(cliRoot, 'dist', relativePath)).href)

const [{ generateBuildManifest }, { resolvePlugins }] = await Promise.all([
  importInternal('build/generate-manifest.js'),
  importInternal('plugins/resolve-plugins.js'),
])

const [resources, config] = await Promise.all([discoverResources(cwd), loadConfig(cwd)])
const plugins = resolvePlugins(config, cwd)
const pluginResources = await Promise.all(
  plugins.map(async (plugin: { name: string; rootDir: string }) => ({
    name: plugin.name,
    rootDir: plugin.rootDir,
    resources: await discoverResources(plugin.rootDir),
  })),
)

generateBuildManifest(cwd, resources, pluginResources, { deploymentPreset: 'vercel' })
