// Plugin resolution — Nuxt Layers style, pure file-system discovery
// Scans config.plugins + auto-detects @manta/plugin-* and @mantajs/plugin-* in node_modules

import { existsSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { LoadedConfig } from '../types'

export interface ResolvedPlugin {
  /** Package name (e.g. "@manta/plugin-posthog-proxy") */
  name: string
  /** Absolute path to the plugin package root — the framework scans its src/ like the app's own */
  rootDir: string
}

/**
 * Resolve all Manta plugins from config + auto-detection.
 * Plugins have NO config — they are pure folders whose files are auto-discovered.
 * If a plugin needs secrets (API keys, hosts), its files read them from environment variables.
 */
export function resolvePlugins(config: LoadedConfig, cwd: string): ResolvedPlugin[] {
  const require = createRequire(resolve(cwd, 'package.json'))

  // Normalize config.plugins entries into simple package names
  const explicitNames = new Set<string>()
  for (const entry of config.plugins ?? []) {
    if (typeof entry === 'string') {
      explicitNames.add(entry)
    } else if (typeof entry === 'object' && entry !== null && 'resolve' in entry) {
      // Tolerate the legacy {resolve, options} shape — just take the name
      explicitNames.add((entry as { resolve: string }).resolve)
    }
  }

  // Resolve explicit plugins to their package root
  const explicit: ResolvedPlugin[] = []
  for (const name of explicitNames) {
    const rootDir = resolvePackageRoot(name, require, cwd)
    if (rootDir) explicit.push({ name, rootDir })
  }

  // Auto-detect plugins from node_modules (skip those already explicit)
  const autoDetected = autoDetectPlugins(cwd, explicitNames)

  // Order: auto-detected first (lowest priority), then explicit — all lower than local app
  return [...autoDetected, ...explicit]
}

// ── Internals ──────────────────────────────────────────────────────

function resolvePackageRoot(name: string, require: NodeRequire, cwd: string): string | null {
  try {
    return dirname(require.resolve(`${name}/package.json`))
  } catch {
    const direct = resolve(cwd, 'node_modules', name)
    return existsSync(resolve(direct, 'package.json')) ? direct : null
  }
}

/**
 * Auto-detect Manta plugins from node_modules.
 * Convention: packages matching @manta/plugin-* or @mantajs/plugin-* with a src/ directory.
 */
function autoDetectPlugins(cwd: string, skipNames: Set<string>): ResolvedPlugin[] {
  const plugins: ResolvedPlugin[] = []
  const scopes = ['@manta', '@mantajs']

  for (const scope of scopes) {
    const scopeDir = resolve(cwd, 'node_modules', scope)
    if (!existsSync(scopeDir)) continue

    for (const entry of readdirSync(scopeDir)) {
      if (!entry.startsWith('plugin-')) continue

      const fullName = `${scope}/${entry}`
      if (skipNames.has(fullName)) continue

      const pkgDir = resolve(scopeDir, entry)
      if (!statSync(pkgDir).isDirectory()) continue
      if (!existsSync(resolve(pkgDir, 'src'))) continue

      plugins.push({ name: fullName, rootDir: pkgDir })
    }
  }

  return plugins
}
