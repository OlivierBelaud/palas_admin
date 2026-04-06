// Section A — Configuration Loading & Validation
// Tests: A-01 → A-16

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findConfigFile, loadConfig, validateConfigForCommand } from '../src/config/load-config'
import { loadEnv } from '../src/config/load-env'
import type { LoadedConfig } from '../src/types'

const TMP = resolve(__dirname, '__tmp_config_test__')

function setup() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true })
}

// -------------------------------------------------------------------
// A-01 — loadEnv loads .env file and sets process.env
// -------------------------------------------------------------------
describe('A — Config loading', () => {
  beforeEach(() => {
    setup()
    // Save env state
  })
  afterEach(() => {
    teardown()
    // Restore env state
    delete process.env['TEST_A01_VAR']
    delete process.env['TEST_A02_VAR']
    delete process.env['TEST_A03_EXISTING']
    delete process.env['DATABASE_URL']
    delete process.env['PORT']
  })

  it('A-01 — loads .env file and sets process.env', () => {
    writeFileSync(join(TMP, '.env'), 'TEST_A01_VAR=hello\n')
    const result = loadEnv(TMP)
    expect(result.loaded).toContain('.env')
    expect(process.env['TEST_A01_VAR']).toBe('hello')
  })

  it('A-02 — .env.local overrides .env (later files win)', () => {
    writeFileSync(join(TMP, '.env'), 'TEST_A02_VAR=base\n')
    writeFileSync(join(TMP, '.env.local'), 'TEST_A02_VAR=local\n')
    loadEnv(TMP)
    expect(process.env['TEST_A02_VAR']).toBe('local')
  })

  it('A-03 — existing process.env values are NOT overwritten', () => {
    process.env['TEST_A03_EXISTING'] = 'original'
    writeFileSync(join(TMP, '.env'), 'TEST_A03_EXISTING=overwritten\n')
    loadEnv(TMP)
    expect(process.env['TEST_A03_EXISTING']).toBe('original')
  })

  it('A-04 — warns when no .env file is found', () => {
    const result = loadEnv(TMP)
    expect(result.loaded).toHaveLength(0)
    expect(result.warnings).toContain('No .env file found. Using environment variables only.')
  })

  it('A-05 — handles quoted values in .env', () => {
    writeFileSync(join(TMP, '.env'), 'DATABASE_URL="postgresql://localhost:5432/test"\n')
    loadEnv(TMP)
    expect(process.env['DATABASE_URL']).toBe('postgresql://localhost:5432/test')
  })

  it('A-06 — ignores comments and empty lines in .env', () => {
    writeFileSync(join(TMP, '.env'), '# comment\n\nPORT=3000\n# another comment\n')
    loadEnv(TMP)
    expect(process.env['PORT']).toBe('3000')
  })

  it('A-07 — loads .env.{NODE_ENV} file', () => {
    const origNodeEnv = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'test'
    writeFileSync(join(TMP, '.env.test'), 'TEST_A02_VAR=from_test_env\n')
    const result = loadEnv(TMP)
    expect(result.loaded).toContain('.env.test')
    expect(process.env['TEST_A02_VAR']).toBe('from_test_env')
    process.env['NODE_ENV'] = origNodeEnv
  })
})

// -------------------------------------------------------------------
// A-08 → A-12 — Config file finding and validation
// -------------------------------------------------------------------
describe('A — Config file resolution', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('A-08 — findConfigFile finds manta.config.ts in cwd', () => {
    writeFileSync(join(TMP, 'manta.config.ts'), 'export default {}')
    writeFileSync(join(TMP, 'package.json'), '{}')
    const found = findConfigFile(TMP)
    expect(found).toBe(resolve(TMP, 'manta.config.ts'))
  })

  it('A-09 — findConfigFile returns null if no config file exists', () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    const found = findConfigFile(TMP)
    expect(found).toBeNull()
  })

  it('A-10 — findConfigFile finds .js extension', () => {
    writeFileSync(join(TMP, 'manta.config.js'), 'module.exports = {}')
    writeFileSync(join(TMP, 'package.json'), '{}')
    const found = findConfigFile(TMP)
    expect(found).toBe(resolve(TMP, 'manta.config.js'))
  })

  it('A-11 — findConfigFile finds .mjs extension', () => {
    writeFileSync(join(TMP, 'manta.config.mjs'), 'export default {}')
    writeFileSync(join(TMP, 'package.json'), '{}')
    const found = findConfigFile(TMP)
    expect(found).toBe(resolve(TMP, 'manta.config.mjs'))
  })
})

// -------------------------------------------------------------------
// A-12 → A-16 — Config validation per command
// -------------------------------------------------------------------
describe('A — Config validation per command', () => {
  it('A-12 — dev requires database.url', () => {
    const config: LoadedConfig = {}
    const errors = validateConfigForCommand(config, 'dev')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('database.url')
  })

  it('A-13 — dev passes with database.url set', () => {
    const config: LoadedConfig = { database: { url: 'postgresql://localhost/test' } }
    const errors = validateConfigForCommand(config, 'dev')
    expect(errors).toHaveLength(0)
  })

  it('A-14 — build does NOT require database.url', () => {
    const config: LoadedConfig = {}
    const errors = validateConfigForCommand(config, 'build')
    expect(errors).toHaveLength(0)
  })

  it('A-15 — init does NOT require any fields', () => {
    const config: LoadedConfig = {}
    const errors = validateConfigForCommand(config, 'init')
    expect(errors).toHaveLength(0)
  })

  it('A-16 — db:migrate requires database.url', () => {
    const config: LoadedConfig = {}
    const errors = validateConfigForCommand(config, 'db:migrate')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('database.url')
  })
})

// -------------------------------------------------------------------
// A-17 → A-20 — Zod schema validation
// -------------------------------------------------------------------
describe('A — Zod schema validation', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('A-17 — rejects invalid port number', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(join(TMP, 'manta.config.mjs'), 'export default { http: { port: 99999 } }\n')
    await expect(loadConfig(TMP)).rejects.toThrow('Invalid configuration')
  })

  it('A-18 — rejects pool.max < pool.min', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(join(TMP, 'manta.config.mjs'), 'export default { database: { pool: { min: 5, max: 2 } } }\n')
    await expect(loadConfig(TMP)).rejects.toThrow('pool.max must be >= pool.min')
  })

  it('A-19 — rejects invalid sameSite value', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(
      join(TMP, 'manta.config.mjs'),
      `export default { auth: { session: { cookie: { sameSite: 'bogus' } } } }\n`,
    )
    await expect(loadConfig(TMP)).rejects.toThrow('Invalid configuration')
  })

  it('A-20 — accepts valid config without errors', async () => {
    writeFileSync(join(TMP, 'package.json'), '{}')
    writeFileSync(
      join(TMP, 'manta.config.mjs'),
      `export default { database: { url: 'postgresql://localhost/db' }, strict: false }\n`,
    )
    const config = await loadConfig(TMP)
    expect(config.database?.url).toBe('postgresql://localhost/db')
  })
})
