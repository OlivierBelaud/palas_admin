// Section A2 — load-config
// Ref: CLI_SPEC §1.1 step 2-3, CLI_TESTS_SPEC §A2

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MantaError } from '@manta/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findConfigFile, loadConfig, validateConfigForCommand } from '../../../src/config/load-config'
import type { LoadedConfig } from '../../../src/types'

const TMP = resolve(__dirname, '__tmp_cfg_test__')

function setup() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
}
function teardown() {
  rmSync(TMP, { recursive: true, force: true })
}

describe('A2 — Config file resolution', () => {
  beforeEach(setup)
  afterEach(teardown)

  // -------------------------------------------------------------------
  // CONFIG-01 — finds manta.config.ts
  // -------------------------------------------------------------------
  it('CONFIG-01 — finds manta.config.ts in cwd', () => {
    writeFileSync(join(TMP, 'manta.config.ts'), 'export default {}')
    writeFileSync(join(TMP, 'package.json'), '{}')
    const found = findConfigFile(TMP)
    expect(found).toBe(resolve(TMP, 'manta.config.ts'))
  })

  // -------------------------------------------------------------------
  // CONFIG-02 — returns null if no config
  // -------------------------------------------------------------------
  it('CONFIG-02 — returns null if no config file exists', () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    const found = findConfigFile(TMP)
    expect(found).toBeNull()
  })

  // -------------------------------------------------------------------
  // CONFIG-03 — finds .js extension
  // -------------------------------------------------------------------
  it('CONFIG-03 — finds .js extension', () => {
    writeFileSync(join(TMP, 'manta.config.js'), 'module.exports = {}')
    writeFileSync(join(TMP, 'package.json'), '{}')
    expect(findConfigFile(TMP)).toBe(resolve(TMP, 'manta.config.js'))
  })

  // -------------------------------------------------------------------
  // CONFIG-04 — finds .mjs extension
  // -------------------------------------------------------------------
  it('CONFIG-04 — finds .mjs extension', () => {
    writeFileSync(join(TMP, 'manta.config.mjs'), 'export default {}')
    writeFileSync(join(TMP, 'package.json'), '{}')
    expect(findConfigFile(TMP)).toBe(resolve(TMP, 'manta.config.mjs'))
  })

  // -------------------------------------------------------------------
  // CONFIG-05 — prefers .ts over .js
  // -------------------------------------------------------------------
  it('CONFIG-05 — prefers .ts over .js when both exist', () => {
    writeFileSync(join(TMP, 'manta.config.ts'), 'export default {}')
    writeFileSync(join(TMP, 'manta.config.js'), 'module.exports = {}')
    writeFileSync(join(TMP, 'package.json'), '{}')
    const found = findConfigFile(TMP)
    expect(found).toBe(resolve(TMP, 'manta.config.ts'))
  })

  // -------------------------------------------------------------------
  // CONFIG-06 — loadConfig throws NOT_FOUND if missing
  // -------------------------------------------------------------------
  it('CONFIG-06 — loadConfig throws if config not found', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    await expect(loadConfig(TMP)).rejects.toThrow('manta.config.ts not found')
  })

  // -------------------------------------------------------------------
  // CONFIG-07 — loadConfig imports and returns config
  // -------------------------------------------------------------------
  it('CONFIG-07 — loadConfig imports .mjs and returns config', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(
      join(TMP, 'manta.config.mjs'),
      'export default { database: { url: "postgresql://localhost/test" } }\n',
    )
    const config = await loadConfig(TMP)
    expect(config.database?.url).toBe('postgresql://localhost/test')
  })
})

describe('A2 — Config validation per command', () => {
  // -------------------------------------------------------------------
  // VALIDATE-01 — dev requires database.url
  // -------------------------------------------------------------------
  it('VALIDATE-01 — dev requires database.url', () => {
    const config: LoadedConfig = {}
    const errors = validateConfigForCommand(config, 'dev')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('database.url')
  })

  // -------------------------------------------------------------------
  // VALIDATE-02 — dev passes with database.url
  // -------------------------------------------------------------------
  it('VALIDATE-02 — dev passes with database.url', () => {
    const config: LoadedConfig = { database: { url: 'postgresql://localhost/test' } }
    expect(validateConfigForCommand(config, 'dev')).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // VALIDATE-03 — build does NOT require database.url
  // -------------------------------------------------------------------
  it('VALIDATE-03 — build does NOT require database.url', () => {
    expect(validateConfigForCommand({}, 'build')).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // VALIDATE-04 — init does NOT require anything
  // -------------------------------------------------------------------
  it('VALIDATE-04 — init does NOT require anything', () => {
    expect(validateConfigForCommand({}, 'init')).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // VALIDATE-05 — db:migrate requires database.url
  // -------------------------------------------------------------------
  it('VALIDATE-05 — db:migrate requires database.url', () => {
    const errors = validateConfigForCommand({}, 'db:migrate')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('database.url')
  })

  // -------------------------------------------------------------------
  // VALIDATE-06 — exec requires database.url
  // -------------------------------------------------------------------
  it('VALIDATE-06 — exec requires database.url', () => {
    const errors = validateConfigForCommand({}, 'exec')
    expect(errors.length).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------
  // VALIDATE-07 — db:generate requires database.url
  // -------------------------------------------------------------------
  it('VALIDATE-07 — db:generate requires database.url', () => {
    const errors = validateConfigForCommand({}, 'db:generate')
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('A2 — Zod schema validation', () => {
  beforeEach(setup)
  afterEach(teardown)

  // -------------------------------------------------------------------
  // SCHEMA-01 — rejects negative port number
  // -------------------------------------------------------------------
  it('SCHEMA-01 — rejects negative port number', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(join(TMP, 'manta.config.mjs'), 'export default { http: { port: -1 } }\n')
    await expect(loadConfig(TMP)).rejects.toThrow('Invalid configuration')
  })

  // -------------------------------------------------------------------
  // SCHEMA-02 — rejects port > 65535
  // -------------------------------------------------------------------
  it('SCHEMA-02 — rejects port > 65535', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(join(TMP, 'manta.config.mjs'), 'export default { http: { port: 70000 } }\n')
    await expect(loadConfig(TMP)).rejects.toThrow('Invalid configuration')
  })

  // -------------------------------------------------------------------
  // SCHEMA-03 — rejects pool.max < pool.min
  // -------------------------------------------------------------------
  it('SCHEMA-03 — rejects pool.max < pool.min', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(join(TMP, 'manta.config.mjs'), 'export default { database: { pool: { min: 10, max: 2 } } }\n')
    await expect(loadConfig(TMP)).rejects.toThrow('pool.max must be >= pool.min')
  })

  // -------------------------------------------------------------------
  // SCHEMA-04 — rejects invalid sameSite value
  // -------------------------------------------------------------------
  it('SCHEMA-04 — rejects invalid sameSite value', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(
      join(TMP, 'manta.config.mjs'),
      `export default { auth: { session: { cookie: { sameSite: 'invalid' } } } }\n`,
    )
    await expect(loadConfig(TMP)).rejects.toThrow('Invalid configuration')
  })

  // -------------------------------------------------------------------
  // SCHEMA-05 — rejects jwtSecret shorter than 16 chars
  // -------------------------------------------------------------------
  it('SCHEMA-05 — rejects jwtSecret shorter than 16 chars', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(join(TMP, 'manta.config.mjs'), `export default { auth: { jwtSecret: 'short' } }\n`)
    await expect(loadConfig(TMP)).rejects.toThrow('jwtSecret must be at least 16 characters')
  })

  // -------------------------------------------------------------------
  // SCHEMA-06 — accepts valid complete config
  // -------------------------------------------------------------------
  it('SCHEMA-06 — accepts valid complete config', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(
      join(TMP, 'manta.config.mjs'),
      `export default {
        database: { url: 'postgresql://localhost/test', pool: { min: 2, max: 10 } },
        http: { port: 3000 },
        auth: { jwtSecret: 'a-very-long-secret-key-1234' },
        strict: true,
        featureFlags: { myFlag: true },
      }\n`,
    )
    const config = await loadConfig(TMP)
    expect(config.database?.url).toBe('postgresql://localhost/test')
    expect(config.http?.port).toBe(3000)
    expect(config.strict).toBe(true)
  })

  // -------------------------------------------------------------------
  // SCHEMA-07 — accepts minimal empty config
  // -------------------------------------------------------------------
  it('SCHEMA-07 — accepts minimal empty config', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(join(TMP, 'manta.config.mjs'), 'export default {}\n')
    const config = await loadConfig(TMP)
    expect(config).toBeDefined()
    expect(config.strict).toBe(false)
  })

  // -------------------------------------------------------------------
  // SCHEMA-08 — thrown error is MantaError with INVALID_DATA
  // -------------------------------------------------------------------
  it('SCHEMA-08 — thrown error is MantaError with INVALID_DATA', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(join(TMP, 'manta.config.mjs'), 'export default { http: { port: -5 } }\n')
    try {
      await loadConfig(TMP)
      expect.fail('should have thrown')
    } catch (err) {
      expect(MantaError.is(err)).toBe(true)
      expect((err as MantaError).type).toBe('INVALID_DATA')
    }
  })
})
