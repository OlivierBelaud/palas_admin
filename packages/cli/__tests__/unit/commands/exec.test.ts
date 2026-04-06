// Section B5 — manta exec command
// Ref: CLI_SPEC §2.9, CLI_TESTS_SPEC §B5
// Tests: script execution, app injection, args passing, --dry-run

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execCommand } from '../../../src/commands/exec'

const TMP = resolve(__dirname, '__tmp_exec_test__')

function setup() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true })
}

describe('B5 — manta exec', () => {
  beforeEach(setup)
  afterEach(teardown)

  // -------------------------------------------------------------------
  // EXEC-01 — Error when script file doesn't exist
  // -------------------------------------------------------------------
  it('EXEC-01 — returns error when script file does not exist', async () => {
    const result = await execCommand({ script: 'scripts/nope.ts' }, TMP)
    expect(result.exitCode).toBe(1)
    expect(result.errors[0]).toContain('Script not found')
  })

  // -------------------------------------------------------------------
  // EXEC-02 — Error when script has no default export
  // -------------------------------------------------------------------
  it('EXEC-02 — returns error when script has no default export', async () => {
    writeFileSync(join(TMP, 'bad-script.mjs'), 'export const foo = 42\n')
    const result = await execCommand({ script: 'bad-script.mjs' }, TMP)
    expect(result.exitCode).toBe(1)
    expect(result.errors[0]).toContain('must export a default async function')
  })

  // -------------------------------------------------------------------
  // EXEC-03 — Executes valid script successfully
  // -------------------------------------------------------------------
  it('EXEC-03 — executes a valid script successfully', async () => {
    writeFileSync(join(TMP, 'good-script.mjs'), 'export default async ({ app, args }) => { /* ok */ }\n')
    const result = await execCommand({ script: 'good-script.mjs' }, TMP)
    expect(result.exitCode).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // EXEC-04 — Captures script errors
  // -------------------------------------------------------------------
  it('EXEC-04 — captures script errors and returns exitCode 1', async () => {
    writeFileSync(join(TMP, 'error-script.mjs'), 'export default async () => { throw new Error("boom") }\n')
    const result = await execCommand({ script: 'error-script.mjs' }, TMP)
    expect(result.exitCode).toBe(1)
    expect(result.errors[0]).toContain('Script failed')
    expect(result.errors[0]).toContain('boom')
  })

  // -------------------------------------------------------------------
  // EXEC-05 — Passes args to the script
  // -------------------------------------------------------------------
  it('EXEC-05 — passes args to the script', async () => {
    writeFileSync(
      join(TMP, 'args-script.mjs'),
      `export default async ({ args }) => {
        if (!args || args.length === 0) throw new Error('no args')
      }\n`,
    )
    const result = await execCommand({ script: 'args-script.mjs', args: ['--count', '10'] }, TMP)
    expect(result.exitCode).toBe(0)
  })

  // -------------------------------------------------------------------
  // EXEC-06 — Script receives app (not null)
  // -------------------------------------------------------------------
  it('EXEC-06 — script receives a real app (not null)', async () => {
    writeFileSync(
      join(TMP, 'app-check.mjs'),
      `export default async ({ app }) => {
        if (!app) throw new Error('app is null')
        if (typeof app.resolve !== 'function') throw new Error('app has no resolve method')
      }\n`,
    )
    const result = await execCommand({ script: 'app-check.mjs' }, TMP)
    expect(result.exitCode).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // EXEC-07 — Empty args when none provided
  // -------------------------------------------------------------------
  it('EXEC-07 — args is empty array when not provided', async () => {
    writeFileSync(
      join(TMP, 'args-empty.mjs'),
      `export default async ({ args }) => {
        if (!Array.isArray(args)) throw new Error('args is not array')
        if (args.length !== 0) throw new Error('args should be empty')
      }\n`,
    )
    const result = await execCommand({ script: 'args-empty.mjs' }, TMP)
    expect(result.exitCode).toBe(0)
  })
})
