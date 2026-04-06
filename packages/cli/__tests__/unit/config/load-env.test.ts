// Section A1 — load-env
// Ref: CLI_SPEC §1.1 step 1, CLI_TESTS_SPEC §A1

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadEnv } from '../../../src/config/load-env'

const TMP = resolve(__dirname, '__tmp_env_test__')

function setup() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
}
function teardown() {
  rmSync(TMP, { recursive: true, force: true })
}

describe('A1 — load-env', () => {
  beforeEach(() => {
    setup()
    delete process.env['TEST_ENV_VAR']
    delete process.env['TEST_OVERRIDE']
    delete process.env['DATABASE_URL']
    delete process.env['PORT']
  })
  afterEach(() => {
    teardown()
    delete process.env['TEST_ENV_VAR']
    delete process.env['TEST_OVERRIDE']
    delete process.env['DATABASE_URL']
    delete process.env['PORT']
  })

  // -------------------------------------------------------------------
  // ENV-01 — loads .env and sets process.env
  // -------------------------------------------------------------------
  it('ENV-01 — loads .env file and sets process.env', () => {
    writeFileSync(join(TMP, '.env'), 'TEST_ENV_VAR=hello\n')
    const result = loadEnv(TMP)
    expect(result.loaded).toContain('.env')
    expect(process.env['TEST_ENV_VAR']).toBe('hello')
  })

  // -------------------------------------------------------------------
  // ENV-02 — .env.local overrides .env
  // -------------------------------------------------------------------
  it('ENV-02 — .env.local overrides .env (later files win)', () => {
    writeFileSync(join(TMP, '.env'), 'TEST_OVERRIDE=base\n')
    writeFileSync(join(TMP, '.env.local'), 'TEST_OVERRIDE=local\n')
    loadEnv(TMP)
    expect(process.env['TEST_OVERRIDE']).toBe('local')
  })

  // -------------------------------------------------------------------
  // ENV-03 — existing process.env NOT overwritten
  // -------------------------------------------------------------------
  it('ENV-03 — existing process.env values are NOT overwritten', () => {
    process.env['TEST_ENV_VAR'] = 'original'
    writeFileSync(join(TMP, '.env'), 'TEST_ENV_VAR=overwritten\n')
    loadEnv(TMP)
    expect(process.env['TEST_ENV_VAR']).toBe('original')
  })

  // -------------------------------------------------------------------
  // ENV-04 — warning when no .env found
  // -------------------------------------------------------------------
  it('ENV-04 — warns when no .env file is found', () => {
    const result = loadEnv(TMP)
    expect(result.loaded).toHaveLength(0)
    expect(result.warnings.some((w) => w.includes('.env'))).toBe(true)
  })

  // -------------------------------------------------------------------
  // ENV-05 — handles quoted values
  // -------------------------------------------------------------------
  it('ENV-05 — handles quoted values in .env', () => {
    writeFileSync(join(TMP, '.env'), 'DATABASE_URL="postgresql://localhost/test"\n')
    loadEnv(TMP)
    expect(process.env['DATABASE_URL']).toBe('postgresql://localhost/test')
  })

  // -------------------------------------------------------------------
  // ENV-06 — ignores comments and empty lines
  // -------------------------------------------------------------------
  it('ENV-06 — ignores comments and empty lines', () => {
    writeFileSync(join(TMP, '.env'), '# comment\n\nPORT=3000\n# another\n')
    loadEnv(TMP)
    expect(process.env['PORT']).toBe('3000')
  })

  // -------------------------------------------------------------------
  // ENV-07 — loads .env.{NODE_ENV}
  // -------------------------------------------------------------------
  it('ENV-07 — loads .env.{NODE_ENV} file', () => {
    const origNodeEnv = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'test'
    writeFileSync(join(TMP, '.env.test'), 'TEST_ENV_VAR=from_test\n')
    const result = loadEnv(TMP)
    expect(result.loaded).toContain('.env.test')
    expect(process.env['TEST_ENV_VAR']).toBe('from_test')
    process.env['NODE_ENV'] = origNodeEnv
  })

  // -------------------------------------------------------------------
  // ENV-08 — full priority chain
  // -------------------------------------------------------------------
  it('ENV-08 — full priority: .env < .env.local < .env.NODE_ENV < .env.NODE_ENV.local', () => {
    const origNodeEnv = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'test'
    writeFileSync(join(TMP, '.env'), 'TEST_ENV_VAR=base\n')
    writeFileSync(join(TMP, '.env.local'), 'TEST_ENV_VAR=local\n')
    writeFileSync(join(TMP, '.env.test'), 'TEST_ENV_VAR=test\n')
    writeFileSync(join(TMP, '.env.test.local'), 'TEST_ENV_VAR=test_local\n')
    loadEnv(TMP)
    expect(process.env['TEST_ENV_VAR']).toBe('test_local')
    process.env['NODE_ENV'] = origNodeEnv
  })

  // -------------------------------------------------------------------
  // ENV-09 — single quotes are stripped
  // -------------------------------------------------------------------
  it('ENV-09 — strips single quotes from values', () => {
    writeFileSync(join(TMP, '.env'), "TEST_ENV_VAR='single_quoted'\n")
    loadEnv(TMP)
    expect(process.env['TEST_ENV_VAR']).toBe('single_quoted')
  })
})
