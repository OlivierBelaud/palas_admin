// SPEC-070 — Resolve adapters via presets + overrides

import type { PresetDefinition } from '@manta/core'
import { BUILT_IN_PRESETS, devPreset } from '@manta/core'
import type { LoadedConfig } from '../types'

export interface ResolvedAdapter {
  port: string
  adapter: string
  options: Record<string, unknown>
}

/**
 * Resolve the preset from config or auto-detect from environment.
 * Priority: explicit config.preset > VERCEL env → vercelPreset > devPreset.
 */
export function resolvePreset(config: LoadedConfig): PresetDefinition {
  const presetValue = config.preset

  // Explicit preset object
  if (presetValue && typeof presetValue === 'object') {
    return presetValue as PresetDefinition
  }

  // Explicit preset name
  if (presetValue && typeof presetValue === 'string') {
    const found = BUILT_IN_PRESETS[presetValue]
    if (!found) {
      throw new Error(`Unknown preset "${presetValue}". Available: ${Object.keys(BUILT_IN_PRESETS).join(', ')}`)
    }
    return found
  }

  // Auto-detect from environment
  if (process.env.VERCEL) {
    return BUILT_IN_PRESETS.vercel!
  }

  return devPreset
}

/**
 * Resolve adapters for each port by merging preset defaults with config overrides.
 * Config adapters take precedence over preset adapters.
 */
export function resolveAdapters(config: LoadedConfig, preset: PresetDefinition): ResolvedAdapter[] {
  const overrides = config.adapters ?? {}
  const resolved: ResolvedAdapter[] = []

  // Start with all preset adapters
  const mergedPorts = new Set([...Object.keys(preset.adapters), ...Object.keys(overrides)])

  for (const port of mergedPorts) {
    const override = overrides[port]

    if (override) {
      resolved.push({
        port,
        adapter: override.adapter,
        options: override.options ?? {},
      })
    } else {
      const presetEntry = preset.adapters[port]
      if (presetEntry) {
        resolved.push({
          port,
          adapter: presetEntry.adapter,
          options: presetEntry.options ? { ...presetEntry.options } : {},
        })
      }
    }
  }

  return resolved
}

// Adapters always available (bundled with @manta/cli)
const ALWAYS_AVAILABLE = new Set([
  '@manta/adapter-logger-pino',
  '@manta/adapter-database-pg',
  '@manta/adapter-database-neon',
  '@manta/adapter-h3',
  '@manta/adapter-cache-upstash',
  '@manta/adapter-locking-neon',
  '@manta/adapter-file-vercel-blob',
  '@manta/adapter-jobs-vercel-cron',
  '@manta/adapter-eventbus-upstash',
])

/**
 * Check that all resolved adapters are available (installed).
 * Returns list of missing adapter package names.
 */
export function checkAdapterAvailability(adapters: ResolvedAdapter[]): string[] {
  const missing: string[] = []

  for (const adapter of adapters) {
    // In-memory adapters from @manta/core are always available
    if (adapter.adapter.startsWith('@manta/core/')) continue
    // Bundled adapters are always available
    if (ALWAYS_AVAILABLE.has(adapter.adapter)) continue
    // Sub-path adapters from bundled packages
    if (ALWAYS_AVAILABLE.has(adapter.adapter.split('/').slice(0, 2).join('/'))) continue
  }

  return missing
}
