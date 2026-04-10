#!/usr/bin/env node
// Auto-install Playwright chromium on fresh clones (BC-F20).
//
// The preflight script (`scripts/check-runtime-preflight.mjs`) fails loudly
// with a how-to-fix message if chromium is missing, but new contributors
// still hit that as their first Playwright failure. This hook closes the
// gap on local machines without slowing down CI or the Playwright-free
// packages.
//
// Conditions (ALL must be true to install):
//   1. Not running in CI  — CI caches browsers externally and auto-install
//      would slow builds and clobber the cache.
//   2. @playwright/test is present in node_modules  — we don't want to run
//      playwright CLI lookups if the repo doesn't need it.
//   3. chromium is not already installed  — detected via `playwright install
//      --dry-run` exit code + stdout parse.
//
// Failure of any probe is treated as "skip silently" — this hook must never
// block `pnpm install`. If the install itself fails, we print a warning and
// continue with exit 0.

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function skip(reason) {
  // Quiet by design — only log at a debug level when explicitly requested.
  if (process.env.MANTA_POSTINSTALL_VERBOSE) {
    console.log(`[postinstall-playwright] skipped: ${reason}`)
  }
  process.exit(0)
}

// 1. CI guard
if (process.env.CI === 'true' || process.env.CI === '1') {
  skip('running in CI — CI is expected to manage browser caches explicitly')
}

// 2. @playwright/test presence
const playwrightPkg = resolve(ROOT, 'node_modules/@playwright/test/package.json')
if (!existsSync(playwrightPkg)) {
  skip('@playwright/test not installed — nothing to provision')
}

// 3. Is chromium already installed?
// `playwright install --dry-run chromium` prints "browser 'chromium' is already installed"
// when nothing needs to happen, or "browser 'chromium' will be installed" otherwise.
const dryRun = spawnSync('pnpm', ['exec', 'playwright', 'install', '--dry-run', 'chromium'], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})

if (dryRun.status !== 0) {
  // If we can't probe, don't block install — just bail quietly.
  skip(`playwright dry-run probe failed (${dryRun.status ?? 'signal'}); leaving browser state untouched`)
}

const dryRunOutput = (dryRun.stdout || '') + (dryRun.stderr || '')
if (!/will be installed|downloading/i.test(dryRunOutput)) {
  skip('chromium already present')
}

// 4. Perform the install
console.log('[postinstall-playwright] Installing Playwright chromium (first-time setup)…')
const install = spawnSync('pnpm', ['exec', 'playwright', 'install', 'chromium'], {
  cwd: ROOT,
  stdio: 'inherit',
})

if (install.status !== 0) {
  console.warn(
    `[postinstall-playwright] WARN: chromium install exited with ${install.status ?? 'signal'}.\n` +
      'Run `pnpm exec playwright install chromium` manually before running `pnpm check:runtime`.',
  )
  // Always exit 0 — do not block the parent install.
}

process.exit(0)
