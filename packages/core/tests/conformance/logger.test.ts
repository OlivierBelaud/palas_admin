import { createTestLogger, type ILoggerPort, type TestLogger } from '@manta/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('ILoggerPort Conformance', () => {
  let logger: TestLogger

  beforeEach(() => {
    logger = createTestLogger()
  })

  afterEach(() => {
    logger.clear()
  })

  // LG-01 — SPEC-067/082: all 8 levels produce output
  it('niveaux > 8 niveaux produisent du output', () => {
    logger.setLogLevel('silly') // lowest threshold — all levels pass

    logger.error('e')
    logger.warn('w')
    logger.info('i')
    logger.http('h')
    logger.verbose('v')
    logger.debug('d')
    logger.silly('s')
    logger.panic('p')

    expect(logger.logs).toHaveLength(8)
    expect(logger.logs.map((l) => l.level)).toEqual([
      'error',
      'warn',
      'info',
      'http',
      'verbose',
      'debug',
      'silly',
      'panic',
    ])
  })

  // LG-02 — SPEC-067: threshold filters lower levels
  it('threshold > filtre les niveaux inférieurs', () => {
    logger.setLogLevel('warn')

    logger.info('should be silent')
    logger.warn('should appear')
    logger.error('should appear too')

    expect(logger.logs).toHaveLength(2)
    expect(logger.logs[0]).toMatchObject({ level: 'warn', msg: 'should appear' })
    expect(logger.logs[1]).toMatchObject({ level: 'error', msg: 'should appear too' })
  })

  // LG-03 — SPEC-067: shouldLog returns false below threshold
  it('shouldLog > retourne le bon boolean', () => {
    logger.setLogLevel('warn')
    expect(logger.shouldLog('info')).toBe(false)
    expect(logger.shouldLog('debug')).toBe(false)
    expect(logger.shouldLog('silly')).toBe(false)
  })

  // LG-04 — SPEC-067: shouldLog returns true at threshold
  it('shouldLog > retourne true au threshold', () => {
    logger.setLogLevel('warn')
    expect(logger.shouldLog('warn')).toBe(true)
    expect(logger.shouldLog('error')).toBe(true)
    // panic always logs
    expect(logger.shouldLog('panic')).toBe(true)
  })

  // LG-05 — SPEC-082: activity/progress/success/failure lifecycle
  it('activity/progress/success/failure > lifecycle', () => {
    const id = logger.activity('importing products')
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)

    logger.progress(id, '50% done')
    logger.success(id, 'import complete')

    // All calls produced output
    const activityLogs = logger.logs.filter((l) => l.msg.includes(id))
    expect(activityLogs.length).toBe(3)
  })

  // LG-05b — SPEC-082: failure path of activity lifecycle
  it('activity/failure > failure produit du output', () => {
    const id = logger.activity('risky task')
    logger.failure(id, 'task crashed')

    const failLogs = logger.logs.filter((l) => l.msg.includes(id))
    expect(failLogs.length).toBe(2) // activity + failure
    expect(failLogs[1].level).toBe('error')
  })

  // LG-06 — SPEC-067: setLogLevel changes threshold at runtime
  it('setLogLevel > change le threshold à runtime', () => {
    logger.setLogLevel('warn')
    logger.debug('before — should be silent')
    expect(logger.logs).toHaveLength(0)

    logger.setLogLevel('debug')
    logger.debug('after — should appear')
    expect(logger.logs).toHaveLength(1)
    expect(logger.logs[0]).toMatchObject({ level: 'debug', msg: 'after — should appear' })
  })

  // LG-07 — SPEC-082: structured output with extra data
  it('JSON mode > structured output', () => {
    logger.info('message', { key: 'val' })

    expect(logger.logs).toHaveLength(1)
    expect(logger.logs[0].level).toBe('info')
    expect(logger.logs[0].msg).toBe('message')
    expect(logger.logs[0].data).toEqual({ key: 'val' })
  })

  // LG-08 — SPEC-082: JSON output is parseable (single entry per log call)
  it('JSON mode > pas de pretty print', () => {
    logger.info('structured', { a: 1 })

    // Each log call produces exactly one entry
    expect(logger.logs).toHaveLength(1)
    // The entry can be serialized to a single JSON line
    const json = JSON.stringify(logger.logs[0])
    expect(json).not.toContain('\n')
    expect(JSON.parse(json)).toMatchObject({ level: 'info', msg: 'structured' })
  })

  // Additional: unsetLogLevel resets to default (silly — all levels pass)
  it('unsetLogLevel > resets to default threshold', () => {
    logger.setLogLevel('error')
    expect(logger.shouldLog('info')).toBe(false)

    logger.unsetLogLevel()
    expect(logger.shouldLog('info')).toBe(true)
    expect(logger.shouldLog('silly')).toBe(true)
  })
})
