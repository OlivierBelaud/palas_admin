// TS-21 + TS-22: Smoke tests — verify all demo files parse and globals are available.
// Does NOT test business logic. Only checks that the codebase is type-safe at compile time.

import { execSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const DEMO_ROOT = resolve(__dirname, '..')
const SRC_DIR = resolve(DEMO_ROOT, 'src')

function walkDir(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walkDir(full, files)
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full)
  }
  return files
}

describe('demo/commerce smoke tests', () => {
  it('TS-21 — all .ts/.tsx files exist and are readable', () => {
    const files = walkDir(SRC_DIR)
    expect(files.length).toBeGreaterThan(0)
  })

  it('TS-22 — tsc --noEmit passes (globals + types all resolve)', () => {
    // Run tsc from the monorepo root, which covers demo/commerce via the root tsconfig
    // (post-TS-08 consolidation). This verifies that:
    //  - All demo files parse
    //  - z, defineCommand, defineQuery, etc. are available as globals
    //  - Generated types (.manta/generated.d.ts) exist and are valid
    //  - Cross-package imports (@manta/core, @manta/sdk) resolve
    const monorepoRoot = resolve(DEMO_ROOT, '..', '..')
    try {
      execSync('npx tsc --noEmit', { cwd: monorepoRoot, stdio: 'pipe' })
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer; stderr?: Buffer }
      const output = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')
      throw new Error(`tsc failed:\n${output.slice(0, 5000)}`)
    }
  }, 60000) // 60s timeout — tsc on full monorepo
})
