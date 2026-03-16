// SPEC-135 -- Module versioning
// Checks module versions at boot, detects upgrades/downgrades

import type { ModuleExports } from './index'

export interface ModuleVersionStore {
  getVersion(moduleName: string): Promise<string | null>
  setVersion(moduleName: string, version: string): Promise<void>
}

export interface VersionMismatch {
  name: string
  expected: string
  actual: string
  type: 'downgrade' | 'mismatch'
}

export interface VersionUpgrade {
  name: string
  from: string
  to: string
}

export interface VersionCheckResult {
  ok: boolean
  mismatches: VersionMismatch[]
  upgrades: VersionUpgrade[]
}

export class ModuleVersionChecker {
  constructor(private _store: ModuleVersionStore) {}

  async checkModules(modules: ModuleExports[]): Promise<VersionCheckResult> {
    const mismatches: VersionMismatch[] = []
    const upgrades: VersionUpgrade[] = []

    for (const mod of modules) {
      if (!mod.version) continue

      const storedVersion = await this._store.getVersion(mod.name)

      if (!storedVersion) {
        // First load -- store the version
        await this._store.setVersion(mod.name, mod.version)
        continue
      }

      if (storedVersion === mod.version) {
        // Matching -- all good
        continue
      }

      // Compare versions (simple semver comparison)
      const comparison = compareSemver(mod.version, storedVersion)

      if (comparison > 0) {
        // Upgrade: code version > stored version
        upgrades.push({
          name: mod.name,
          from: storedVersion,
          to: mod.version,
        })
        await this._store.setVersion(mod.name, mod.version)
      } else {
        // Downgrade: code version < stored version
        mismatches.push({
          name: mod.name,
          expected: storedVersion,
          actual: mod.version,
          type: 'downgrade',
        })
      }
    }

    return {
      ok: mismatches.length === 0,
      mismatches,
      upgrades,
    }
  }
}

// Simple semver comparison: returns positive if a > b, negative if a < b, 0 if equal
function compareSemver(a: string, b: string): number {
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const va = partsA[i] ?? 0
    const vb = partsB[i] ?? 0
    if (va !== vb) return va - vb
  }
  return 0
}
