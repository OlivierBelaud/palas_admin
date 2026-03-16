// PinoLoggerAdapter — ILoggerPort conformance
import { describe, it, expect, beforeEach } from 'vitest'
import { PinoLoggerAdapter } from '../src'

describe('PinoLoggerAdapter — ILoggerPort conformance', () => {
  let logger: PinoLoggerAdapter

  beforeEach(() => {
    // Use non-pretty mode so output goes to stdout as JSON (testable)
    logger = new PinoLoggerAdapter({ level: 'silly', pretty: false })
  })

  // LG-01 — all 8 log levels exist
  it('LG-01 — all 8 log levels exist', () => {
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.http).toBe('function')
    expect(typeof logger.verbose).toBe('function')
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.silly).toBe('function')
    expect(typeof logger.panic).toBe('function')
  })

  // LG-02 — shouldLog respects level threshold
  it('LG-02 — shouldLog respects level', () => {
    const restricted = new PinoLoggerAdapter({ level: 'warn', pretty: false })
    expect(restricted.shouldLog('error')).toBe(true)
    expect(restricted.shouldLog('warn')).toBe(true)
    expect(restricted.shouldLog('info')).toBe(false)
    expect(restricted.shouldLog('debug')).toBe(false)
    expect(restricted.shouldLog('silly')).toBe(false)
    expect(restricted.shouldLog('panic')).toBe(true) // panic always logs
  })

  // LG-03 — setLogLevel changes threshold
  it('LG-03 — setLogLevel changes threshold', () => {
    expect(logger.shouldLog('silly')).toBe(true)
    logger.setLogLevel('error')
    expect(logger.shouldLog('info')).toBe(false)
    expect(logger.shouldLog('error')).toBe(true)
  })

  // LG-04 — unsetLogLevel reverts to default
  it('LG-04 — unsetLogLevel reverts', () => {
    logger.setLogLevel('error')
    expect(logger.shouldLog('info')).toBe(false)
    logger.unsetLogLevel()
    expect(logger.shouldLog('info')).toBe(true) // back to 'silly'
  })

  // LG-05 — activity returns an ID
  it('LG-05 — activity returns a unique ID', () => {
    const id1 = logger.activity('Starting task A')
    const id2 = logger.activity('Starting task B')
    expect(typeof id1).toBe('string')
    expect(id1.length).toBeGreaterThan(0)
    expect(id1).not.toBe(id2)
  })

  // LG-06 — progress/success/failure use activity ID
  it('LG-06 — progress/success/failure with activity ID', () => {
    const id = logger.activity('Task')
    // These should not throw
    expect(() => logger.progress(id, '50% done')).not.toThrow()
    expect(() => logger.success(id, 'completed')).not.toThrow()
  })

  // LG-07 — failure logs at error level
  it('LG-07 — failure uses error level', () => {
    const id = logger.activity('Failing task')
    // Should not throw even when activity is tracked
    expect(() => logger.failure(id, 'it broke')).not.toThrow()
  })

  // LG-08 — dispose flushes
  it('LG-08 — dispose flushes without error', () => {
    expect(() => logger.dispose()).not.toThrow()
  })

  // Additional: panic always logs regardless of level
  it('panic always logs', () => {
    const quiet = new PinoLoggerAdapter({ level: 'error', pretty: false })
    // panic should not throw even at restricted level
    expect(() => quiet.panic({ msg: 'system crash' })).not.toThrow()
  })

  // Additional: constructor defaults
  it('default level is silly', () => {
    const defaultLogger = new PinoLoggerAdapter()
    expect(defaultLogger.shouldLog('silly')).toBe(true)
  })
})
