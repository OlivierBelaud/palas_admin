// SPEC-067/082 — PinoLoggerAdapter conformance tests (LG-01 → LG-08)

import { Writable } from 'node:stream'
import { PinoLoggerAdapter } from '@manta/adapter-logger-pino'
import pino from 'pino'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * Creates a PinoLoggerAdapter that writes to a capturable buffer.
 * Returns { logger, getOutput } where getOutput() returns all lines written.
 */
function createCapturingLogger(level = 'silly') {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString())
      callback()
    },
  })
  // Build a pino instance writing to our stream, then inject it
  const pinoInstance = pino({ level: 'trace' }, stream)
  const logger = new PinoLoggerAdapter({ level, pretty: false })
  // Replace the internal pino logger with our capturing one
  ;(logger as unknown as { logger: pino.Logger }).logger = pinoInstance
  return {
    logger,
    getOutput: () => chunks.join(''),
    getLines: () => chunks.flatMap((c) => c.split('\n').filter(Boolean)),
  }
}

describe('PinoLoggerAdapter Conformance', () => {
  let logger: PinoLoggerAdapter

  beforeEach(() => {
    // JSON mode (no pretty) for testability
    logger = new PinoLoggerAdapter({ level: 'silly', pretty: false })
  })

  // LG-01 — all 8 levels produce output (no crash, methods exist)
  it('LG-01: all 8 levels callable without error', () => {
    expect(() => {
      logger.error('e')
      logger.warn('w')
      logger.info('i')
      logger.http('h')
      logger.verbose('v')
      logger.debug('d')
      logger.silly('s')
      logger.panic('p')
    }).not.toThrow()
  })

  // LG-02 — threshold filtering works
  it('LG-02: shouldLog filters by threshold', () => {
    logger.setLogLevel('warn')

    // Below threshold — should not log
    expect(logger.shouldLog('info')).toBe(false)
    expect(logger.shouldLog('http')).toBe(false)
    expect(logger.shouldLog('verbose')).toBe(false)
    expect(logger.shouldLog('debug')).toBe(false)
    expect(logger.shouldLog('silly')).toBe(false)

    // At or above threshold — should log
    expect(logger.shouldLog('warn')).toBe(true)
    expect(logger.shouldLog('error')).toBe(true)
  })

  // LG-03 — shouldLog returns false below threshold
  it('LG-03: shouldLog returns false below threshold', () => {
    logger.setLogLevel('warn')
    expect(logger.shouldLog('info')).toBe(false)
    expect(logger.shouldLog('debug')).toBe(false)
    expect(logger.shouldLog('silly')).toBe(false)
  })

  // LG-04 — shouldLog returns true at/above threshold, panic always true
  it('LG-04: shouldLog true at threshold, panic always true', () => {
    logger.setLogLevel('warn')
    expect(logger.shouldLog('warn')).toBe(true)
    expect(logger.shouldLog('error')).toBe(true)
    expect(logger.shouldLog('panic')).toBe(true)
  })

  // LG-05 — activity/progress/success lifecycle
  it('LG-05: activity returns unique ID, progress/success callable', () => {
    const id = logger.activity('importing products')
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)

    // These should not throw
    expect(() => {
      logger.progress(id, '50% done')
      logger.success(id, 'import complete')
    }).not.toThrow()
  })

  // LG-05b — failure path: verify failure message appears in output
  it('LG-05b: activity/failure lifecycle writes to log output', () => {
    const { logger: capLogger, getOutput } = createCapturingLogger()
    const id = capLogger.activity('risky task')
    capLogger.failure(id, 'task crashed')
    const output = getOutput()
    expect(output).toContain(`[failure:${id}]`)
    expect(output).toContain('task crashed')
  })

  // LG-06 — setLogLevel changes threshold at runtime
  it('LG-06: setLogLevel changes threshold', () => {
    logger.setLogLevel('warn')
    expect(logger.shouldLog('debug')).toBe(false)

    logger.setLogLevel('debug')
    expect(logger.shouldLog('debug')).toBe(true)
  })

  // LG-07 — structured data appears in output
  it('LG-07: structured data appears in log output', () => {
    const { logger: capLogger, getLines } = createCapturingLogger()
    capLogger.info('message', { key: 'val' })
    const lines = getLines()
    expect(lines.length).toBeGreaterThan(0)
    const parsed = JSON.parse(lines[0])
    expect(parsed.msg).toBe('message')
    expect(parsed.key).toBe('val')
  })

  // LG-08 — JSON output: verify each line is valid JSON
  it('LG-08: JSON mode produces valid JSON output', () => {
    const { logger: capLogger, getLines } = createCapturingLogger()
    capLogger.info('structured', { a: 1 })
    capLogger.warn('another')
    const lines = getLines()
    expect(lines.length).toBeGreaterThanOrEqual(2)
    for (const line of lines) {
      const parsed = JSON.parse(line) // throws if not valid JSON
      expect(parsed).toHaveProperty('msg')
      expect(parsed).toHaveProperty('level')
    }
  })

  // unsetLogLevel resets to default
  it('unsetLogLevel resets to default threshold', () => {
    logger.setLogLevel('error')
    expect(logger.shouldLog('info')).toBe(false)

    logger.unsetLogLevel()
    expect(logger.shouldLog('info')).toBe(true)
    expect(logger.shouldLog('silly')).toBe(true)
  })

  // activity IDs are unique
  it('activity IDs are unique across calls', () => {
    const id1 = logger.activity('task1')
    const id2 = logger.activity('task2')
    expect(id1).not.toBe(id2)
  })

  // dispose flushes the logger and subsequent writes still don't crash
  it('dispose flushes logger and is safe to call', () => {
    const { logger: capLogger, getOutput } = createCapturingLogger()
    capLogger.info('before-dispose')
    capLogger.dispose()
    // After flush, the pre-dispose message should be in the output
    const output = getOutput()
    expect(output).toContain('before-dispose')
    // Subsequent writes after dispose should not throw (pino is resilient)
    expect(() => capLogger.info('after-dispose')).not.toThrow()
  })
})
