// Section B3 — manta start command
// Ref: CLI_SPEC §2.7, CLI_TESTS_SPEC §B3

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCommand } from '../../../src/commands/build'
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
    delete process.env.JWT_SECRET
    delete process.env.COOKIE_SECRET
    delete process.env.DATABASE_URL
  })
  afterEach(() => {
    teardown()
    delete process.env.JWT_SECRET
    delete process.env.COOKIE_SECRET
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
    expect(allErrors.includes('JWT_SECRET') || allErrors.includes('config')).toBe(true)
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
    expect(result.errors.some((e) => e.includes('JWT_SECRET'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // START-03 — Exit(1) if COOKIE_SECRET absent when sessions enabled
  // -------------------------------------------------------------------
  it('START-03 — exit 1 if COOKIE_SECRET absent when sessions enabled', async () => {
    process.env.JWT_SECRET = 'test-secret-32-chars-long-enough'
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
    expect(result.errors.some((e) => e.includes('COOKIE_SECRET'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // START-04 — No error if COOKIE_SECRET absent when sessions disabled
  // -------------------------------------------------------------------
  it('START-04 — no COOKIE_SECRET error when sessions disabled', async () => {
    process.env.JWT_SECRET = 'test-secret-32-chars-long-enough'
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
    const cookieErrors = result.errors.filter((e) => e.includes('COOKIE_SECRET'))
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

  // -------------------------------------------------------------------
  // START-06 — BC-F18: refuse to start when build preset != 'node'
  // -------------------------------------------------------------------
  it('START-06 — exit 1 when the last build used --preset vercel', async () => {
    // Arrange: a minimal project with JWT_SECRET set + a build-info.json
    // pretending the last build was produced with --preset vercel.
    process.env.JWT_SECRET = 'test-secret-32-chars-long-enough'
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(
      join(TMP, 'manta.config.mjs'),
      'export default { database: { url: "postgresql://localhost/test" } }\n',
    )
    mkdirSync(join(TMP, '.manta', 'manifest'), { recursive: true })
    writeFileSync(
      join(TMP, '.manta', 'manifest', 'build-info.json'),
      JSON.stringify({ preset: 'vercel', builtAt: new Date().toISOString() }),
    )

    const result = await startCommand({}, TMP)

    expect(result.exitCode).toBe(1)
    const errs = result.errors.join(' ')
    expect(errs).toContain('preset node')
    expect(errs).toContain('vercel')
  })

  // -------------------------------------------------------------------
  // START-07 — BC-F18: allow start when build preset is 'node'
  // -------------------------------------------------------------------
  it('START-07 — passes the preset check when build-info records --preset node', async () => {
    process.env.JWT_SECRET = 'test-secret-32-chars-long-enough'
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(
      join(TMP, 'manta.config.mjs'),
      'export default { database: { url: "postgresql://localhost/test" } }\n',
    )
    mkdirSync(join(TMP, '.manta', 'manifest'), { recursive: true })
    writeFileSync(
      join(TMP, '.manta', 'manifest', 'build-info.json'),
      JSON.stringify({ preset: 'node', builtAt: new Date().toISOString() }),
    )

    const result = await startCommand({}, TMP)

    // It will still fail later (no real .output dir, no real DB), but NOT with
    // the preset-mismatch error. The whole point is to make sure start did
    // NOT reject the build before trying to launch Nitro.
    const errs = result.errors.join(' ')
    expect(errs).not.toContain('preset node')
  })

  // -------------------------------------------------------------------
  // START-08 — BC-F18: manta build writes build-info.json with the preset
  // -------------------------------------------------------------------
  it('START-08 — manta build writes .manta/manifest/build-info.json with the preset', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')

    const result = await buildCommand({ preset: 'vercel' }, TMP)
    expect(result.exitCode).toBe(0)

    const buildInfoPath = join(TMP, '.manta', 'manifest', 'build-info.json')
    expect(existsSync(buildInfoPath)).toBe(true)

    const { readFileSync } = await import('node:fs')
    const info = JSON.parse(readFileSync(buildInfoPath, 'utf-8')) as { preset: string; builtAt: string }
    expect(info.preset).toBe('vercel')
    expect(typeof info.builtAt).toBe('string')
  })
})
