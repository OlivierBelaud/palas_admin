// Section B2 — manta dev command
// Ref: CLI_SPEC §2.1, CLI_TESTS_SPEC §B2
// Tests: profile, config validation, error messages, bootstrap call

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { devCommand } from '../../../src/commands/dev'

const TMP = resolve(__dirname, '__tmp_dev_test__')

function setup() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true })
}

describe('B2 — manta dev', () => {
  beforeEach(() => {
    setup()
    // Clear env vars that might interfere
    delete process.env['DATABASE_URL']
    delete process.env['JWT_SECRET']
  })
  afterEach(teardown)

  // -------------------------------------------------------------------
  // DEV-01 — Profile is forced to 'dev'
  // -------------------------------------------------------------------
  it('DEV-01 — profile is always dev', async () => {
    // devCommand should internally use profile='dev'
    // We test by checking that it doesn't validate prod secrets
    // (which would fail since JWT_SECRET isn't set)
    const result = await devCommand({ port: 9999 }, TMP)
    // Without a config file, it should fail on missing config, not on secrets
    expect(result.exitCode).toBe(1)
    expect(result.errors.some(e => e.includes('manta.config.ts') || e.includes('database.url'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // DEV-02 — Exit(1) if database.url absent
  // -------------------------------------------------------------------
  it('DEV-02 — exit 1 if database.url absent with message', async () => {
    // Create a minimal config without database.url
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(
      join(TMP, 'manta.config.mjs'),
      'export default { http: { port: 9000 } }\n',
    )
    const result = await devCommand({}, TMP)
    expect(result.exitCode).toBe(1)
    expect(result.errors.some(e => e.includes('database.url'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // DEV-03 — Exit(1) if manta.config.ts absent
  // -------------------------------------------------------------------
  it('DEV-03 — exit 1 if manta.config.ts absent', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    // No config file
    const result = await devCommand({}, TMP)
    expect(result.exitCode).toBe(1)
    expect(result.errors.some(e => e.includes('manta.config'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // DEV-04 — Warning if .env absent (not exit)
  // -------------------------------------------------------------------
  it('DEV-04 — warns if .env absent, does not exit for that reason', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    // No .env, no config → should exit for config reasons, but should have .env warning
    const result = await devCommand({}, TMP)
    // The .env warning should be in warnings, not causing the exit
    expect(result.warnings.some(w => w.includes('.env'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // DEV-05 — Returns result with required structure
  // -------------------------------------------------------------------
  it('DEV-05 — returns result with exitCode, errors, warnings', async () => {
    const result = await devCommand({}, TMP)
    expect(typeof result.exitCode).toBe('number')
    expect(Array.isArray(result.errors)).toBe(true)
    expect(Array.isArray(result.warnings)).toBe(true)
  })
})
