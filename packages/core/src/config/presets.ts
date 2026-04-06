// SPEC-070 — Preset system for adapter assembly

import { MantaError } from '../errors/manta-error'

/**
 * A single adapter entry in a preset.
 */
export interface PresetAdapterEntry {
  /** Package name or path of the adapter (e.g. '@manta/adapter-database-pg') */
  adapter: string
  /** Adapter-specific options */
  options?: Record<string, unknown>
}

/**
 * Preset definition — a named collection of adapter bindings for each port.
 */
export interface PresetDefinition {
  /** Human-readable preset name */
  name: string
  /** Target profile (dev or prod) */
  profile: 'dev' | 'prod'
  /** Map of port name → adapter entry */
  adapters: Record<string, PresetAdapterEntry>
}

/**
 * Define a preset — a named collection of adapter bindings.
 *
 * @example
 * ```typescript
 * export const vercelPreset = definePreset({
 *   name: 'vercel',
 *   profile: 'prod',
 *   adapters: {
 *     database: { adapter: '@manta/adapter-database-neon' },
 *     cache: { adapter: '@manta/adapter-cache-upstash' },
 *     file: { adapter: '@manta/adapter-file-vercel-blob' },
 *   },
 * })
 * ```
 */
export function definePreset(preset: PresetDefinition): PresetDefinition {
  if (!preset.name) throw new MantaError('INVALID_DATA', 'Preset name is required')
  if (!preset.profile) throw new MantaError('INVALID_DATA', 'Preset profile is required (dev or prod)')
  if (!preset.adapters || Object.keys(preset.adapters).length === 0) {
    throw new MantaError('INVALID_DATA', 'Preset must define at least one adapter')
  }
  return preset
}
