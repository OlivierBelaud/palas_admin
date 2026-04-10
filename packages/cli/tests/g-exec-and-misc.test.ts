// Section G — exec command + miscellaneous utilities
// Tests: G-01 → G-12

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execCommand } from '../src/commands/exec'
import { createCliLogger } from '../src/utils/logger'
import { createSpinner } from '../src/utils/spinner'

const TMP = resolve(__dirname, '__tmp_exec_test__')

function setup() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true })
}

// -------------------------------------------------------------------
// G-01 → G-05 — manta exec
// -------------------------------------------------------------------
describe('G — manta exec', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('G-01 — returns error when script file does not exist', async () => {
    const result = await execCommand({ script: 'scripts/nope.ts' }, TMP)
    expect(result.exitCode).toBe(1)
    expect(result.errors[0]).toContain('Script not found')
  })

  it('G-02 — returns error when script has no default export', async () => {
    writeFileSync(join(TMP, 'bad-script.mjs'), 'export const foo = 42\n')
    const result = await execCommand({ script: 'bad-script.mjs' }, TMP)
    expect(result.exitCode).toBe(1)
    expect(result.errors[0]).toContain('must export a default async function')
  })

  it('G-03 — executes a valid script successfully', async () => {
    writeFileSync(join(TMP, 'good-script.mjs'), 'export default async ({ app, args }) => { /* ok */ }\n')
    const result = await execCommand({ script: 'good-script.mjs' }, TMP)
    expect(result.exitCode).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it('G-04 — captures script errors and returns exitCode 1', async () => {
    writeFileSync(join(TMP, 'error-script.mjs'), 'export default async () => { throw new Error("boom") }\n')
    const result = await execCommand({ script: 'error-script.mjs' }, TMP)
    expect(result.exitCode).toBe(1)
    expect(result.errors[0]).toContain('Script failed')
    expect(result.errors[0]).toContain('boom')
  })

  it('G-05 — passes args to the script', async () => {
    writeFileSync(
      join(TMP, 'args-script.mjs'),
      `export default async ({ args }) => {
        if (!args || args.length === 0) throw new Error('no args')
      }\n`,
    )
    const result = await execCommand({ script: 'args-script.mjs', args: ['--count', '10'] }, TMP)
    expect(result.exitCode).toBe(0)
  })
})

// -------------------------------------------------------------------
// G-06 → G-09 — CLI Logger utility
// -------------------------------------------------------------------
describe('G — CLI Logger', () => {
  it('G-06 — createCliLogger logs messages through console', () => {
    const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    const logger = createCliLogger('debug')
    logger.error('err-msg')
    expect(spyError).toHaveBeenCalledWith(expect.stringContaining('err-msg'))
    logger.warn('warn-msg')
    expect(spyWarn).toHaveBeenCalledWith(expect.stringContaining('warn-msg'))
    logger.info('info-msg')
    expect(spyLog).toHaveBeenCalledWith(expect.stringContaining('info-msg'))
    logger.debug('debug-msg')
    expect(spyLog).toHaveBeenCalledWith(expect.stringContaining('debug-msg'))

    spyError.mockRestore()
    spyWarn.mockRestore()
    spyLog.mockRestore()
  })

  it('G-07 — logger at info level suppresses debug output', () => {
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    const logger = createCliLogger('info')
    logger.debug('should-be-suppressed')
    expect(spyLog).not.toHaveBeenCalledWith(expect.stringContaining('should-be-suppressed'))

    logger.info('should-appear')
    expect(spyLog).toHaveBeenCalledWith(expect.stringContaining('should-appear'))

    spyLog.mockRestore()
  })

  it('G-08 — setLevel changes the logging level', () => {
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    const logger = createCliLogger('error')
    // At 'error' level, debug should be suppressed
    logger.debug('before-change')
    expect(spyLog).not.toHaveBeenCalled()

    // After setLevel('debug'), debug should be emitted
    logger.setLevel('debug')
    logger.debug('after-change')
    expect(spyLog).toHaveBeenCalledWith(expect.stringContaining('after-change'))

    spyLog.mockRestore()
  })
})

// -------------------------------------------------------------------
// G-09 → G-10 — Spinner utility
// -------------------------------------------------------------------
describe('G — Spinner', () => {
  it('G-09 — createSpinner start/stop/fail write to stdout', () => {
    const spyWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const spinner = createSpinner()
    spinner.start('loading')
    expect(spyWrite).toHaveBeenCalledWith(expect.stringContaining('loading'))

    spinner.stop('done')
    expect(spyWrite).toHaveBeenCalledWith(expect.stringContaining('done'))

    spinner.fail('oops')
    expect(spyWrite).toHaveBeenCalledWith(expect.stringContaining('oops'))

    spyWrite.mockRestore()
  })

  it('G-10 — spinner stop without message writes newline', () => {
    const spyWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const spinner = createSpinner()
    spinner.stop()
    expect(spyWrite).toHaveBeenCalledWith('\n')

    spyWrite.mockRestore()
  })
})

// -------------------------------------------------------------------
// G-11 → G-12 — Profile resolution
// -------------------------------------------------------------------
describe('G — Profile resolution', () => {
  it('G-11 — ConfigManager.detectProfile returns dev by default', async () => {
    const { ConfigManager } = await import('@manta/core')
    const orig = process.env.APP_ENV
    const origNode = process.env.NODE_ENV
    delete process.env.APP_ENV
    process.env.NODE_ENV = 'development'

    expect(ConfigManager.detectProfile()).toBe('dev')

    if (orig !== undefined) process.env.APP_ENV = orig
    else delete process.env.APP_ENV
    if (origNode !== undefined) process.env.NODE_ENV = origNode
    else delete process.env.NODE_ENV
  })

  it('G-12 — ConfigManager.detectProfile returns prod for production', async () => {
    const { ConfigManager } = await import('@manta/core')
    const orig = process.env.APP_ENV
    const origNode = process.env.NODE_ENV
    delete process.env.APP_ENV
    process.env.NODE_ENV = 'production'

    expect(ConfigManager.detectProfile()).toBe('prod')

    if (orig !== undefined) process.env.APP_ENV = orig
    else delete process.env.APP_ENV
    if (origNode !== undefined) process.env.NODE_ENV = origNode
    else delete process.env.NODE_ENV
  })
})
