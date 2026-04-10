#!/usr/bin/env node
// Preflight checks for `check:runtime`.
// 1. In CI, require TEST_DATABASE_URL (or explicit SKIP_RUNTIME_SMOKE=1 opt-out).
// 2. Always require a usable Chromium install (Playwright browser).

import { existsSync } from 'node:fs'

function die(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

if (process.env.CI === 'true' && !process.env.TEST_DATABASE_URL && !process.env.SKIP_RUNTIME_SMOKE) {
  die('ERROR: check:runtime requires TEST_DATABASE_URL in CI. Set it or SKIP_RUNTIME_SMOKE=1 to opt out.')
}

try {
  const mod = await import('@playwright/test')
  const chromium = mod.chromium
  const execPath = chromium.executablePath()
  if (!execPath || !existsSync(execPath)) {
    die('ERROR: Chromium not installed. Run: pnpm exec playwright install chromium --with-deps')
  }
} catch {
  die('ERROR: Chromium not installed. Run: pnpm exec playwright install chromium --with-deps')
}

process.exit(0)
