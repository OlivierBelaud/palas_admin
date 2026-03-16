// Section B3 — manta start command
// Ref: CLI_SPEC §2.7, CLI_TESTS_SPEC §B3

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { startCommand } from '../../../src/commands/start'

const TMP = resolve(__dirname, '__tmp_start_test__')

function setup() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true })
}

describe('B3 — manta start', () => {
  beforeEach(() => {
    setup()
    delete process.env['JWT_SECRET']
    delete process.env['COOKIE_SECRET']
    delete process.env['DATABASE_URL']
  })
  afterEach(() => {
    teardown()
    delete process.env['JWT_SECRET']
    delete process.env['COOKIE_SECRET']
  })

  // -------------------------------------------------------------------
  // START-01 — Profile is forced to 'prod'
  // -------------------------------------------------------------------
  it('START-01 — profile is always prod', async () => {
    // Start should validate prod secrets, which dev doesn't
    const result = await startCommand({}, TMP)
    expect(result.exitCode).toBe(1)
    // Should fail on missing config or missing JWT_SECRET
    expect(result.errors.length).toBeGreaterThan(0)
    const allErrors = result.errors.join(' ')
    expect(
      allErrors.includes('JWT_SECRET') || allErrors.includes('config'),
    ).toBe(true)
  })

  // -------------------------------------------------------------------
  // START-02 — Exit(1) if JWT_SECRET absent in prod
  // -------------------------------------------------------------------
  it('START-02 — exit 1 if JWT_SECRET absent in prod', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(
      join(TMP, 'manta.config.mjs'),
      'export default { database: { url: "postgresql://localhost/test" } }\n',
    )
    const result = await startCommand({}, TMP)
    expect(result.exitCode).toBe(1)
    expect(result.errors.some(e => e.includes('JWT_SECRET'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // START-03 — Exit(1) if COOKIE_SECRET absent when sessions enabled
  // -------------------------------------------------------------------
  it('START-03 — exit 1 if COOKIE_SECRET absent when sessions enabled', async () => {
    process.env['JWT_SECRET'] = 'test-secret-32-chars-long-enough'
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(
      join(TMP, 'manta.config.mjs'),
      `export default {
        database: { url: "postgresql://localhost/test" },
        auth: { session: { enabled: true } }
      }\n`,
    )
    const result = await startCommand({}, TMP)
    expect(result.exitCode).toBe(1)
    expect(result.errors.some(e => e.includes('COOKIE_SECRET'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // START-04 — No error if COOKIE_SECRET absent when sessions disabled
  // -------------------------------------------------------------------
  it('START-04 — no COOKIE_SECRET error when sessions disabled', async () => {
    process.env['JWT_SECRET'] = 'test-secret-32-chars-long-enough'
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(
      join(TMP, 'manta.config.mjs'),
      `export default {
        database: { url: "postgresql://localhost/test" },
        auth: { session: { enabled: false } }
      }\n`,
    )
    const result = await startCommand({}, TMP)
    // Should NOT fail on COOKIE_SECRET
    const cookieErrors = result.errors.filter(e => e.includes('COOKIE_SECRET'))
    expect(cookieErrors).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // START-05 — Returns result with required structure
  // -------------------------------------------------------------------
  it('START-05 — returns result with exitCode, errors, warnings', async () => {
    const result = await startCommand({}, TMP)
    // exitCode should be 1 since no config/secrets are set
    expect(result.exitCode).toBe(1)
    // errors should contain at least one meaningful error message
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]!.length).toBeGreaterThan(0)
    // warnings is always an array (may be empty)
    expect(result.warnings).toBeInstanceOf(Array)
  })
})
