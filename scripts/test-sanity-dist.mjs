#!/usr/bin/env node
// Structural regression guard (BC-F5).
//
// Ensures vitest exclude rules still prevent stale dist/ artifacts from being
// discovered and executed. The root vitest.config.ts, tsconfig.json, and
// packages/cli/vitest.config.ts were hardened in Phase 1 of the 2026-04-10
// Baseline Cleanup epic — this test catches any future regression of those
// excludes without waiting for the 24-failure scenario to reappear.
//
// Strategy:
//   1. Create a fake stale test file under dist/ that would throw if discovered
//   2. Run `vitest list` (discovery without execution) at the root and in packages/cli
//   3. Assert the stale file is NOT in either listing
//   4. Clean up the fake file — always, even on failure

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STALE_DIR = resolve(ROOT, 'dist/packages/cli/__tests__/integration')
const STALE_FILES = [
  resolve(STALE_DIR, 'stale-sanity.integration.test.js'),
  resolve(STALE_DIR, 'stale-sanity.test.js'),
  resolve(STALE_DIR, 'stale-sanity.integration.test.ts'),
  resolve(STALE_DIR, 'stale-sanity.test.ts'),
]
const STALE_CONTENT = `// SANITY GUARD — should never be discovered by vitest.
throw new Error('BC-F5 regression: vitest discovered a stale dist/ test file')
`

function createStaleFixture() {
  mkdirSync(STALE_DIR, { recursive: true })
  for (const file of STALE_FILES) {
    writeFileSync(file, STALE_CONTENT, 'utf8')
  }
}

function removeStaleFixture() {
  for (const file of STALE_FILES) {
    if (existsSync(file)) rmSync(file, { force: true })
  }
  // Best-effort: remove empty dist/ tree we created
  try {
    rmSync(resolve(ROOT, 'dist'), { recursive: true, force: true })
  } catch {
    // ignore — dist may contain legitimate artifacts in other contexts
  }
}

function runVitestList(cwd) {
  try {
    return execSync('pnpm exec vitest list', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1' },
    })
  } catch (err) {
    // `vitest list` exits non-zero when there are no matching tests — that's fine
    // for our sanity check, we just want the stdout listing
    return (err.stdout || '') + (err.stderr || '')
  }
}

function assertNotDiscovered(listing, label) {
  if (listing.includes('stale-sanity')) {
    throw new Error(
      `BC-F5 REGRESSION (${label}): vitest discovered stale-sanity test file(s).\n` +
        `This means a dist/ exclude was removed or weakened. Check:\n` +
        `  - vitest.config.ts exclude: **/dist/**\n` +
        `  - packages/cli/vitest.config.ts exclude: **/dist/**\n` +
        `  - tsconfig.json exclude: **/dist/**\n\n` +
        `vitest listing:\n${listing}`,
    )
  }
}

let failed = false
try {
  console.log('[sanity-dist] Creating fake stale test fixture under dist/…')
  createStaleFixture()

  console.log('[sanity-dist] Running `vitest list` at repo root…')
  const rootListing = runVitestList(ROOT)
  assertNotDiscovered(rootListing, 'root')

  console.log('[sanity-dist] Running `vitest list` in packages/cli…')
  const cliListing = runVitestList(resolve(ROOT, 'packages/cli'))
  assertNotDiscovered(cliListing, 'packages/cli')

  console.log('[sanity-dist] OK — stale dist/ files are properly excluded.')
} catch (err) {
  failed = true
  console.error(`[sanity-dist] FAIL\n${err.message || err}`)
} finally {
  removeStaleFixture()
}

process.exit(failed ? 1 : 0)
