import { defineJob } from '@manta/core'
import { describe, expect, it } from 'vitest'

describe('defineJob()', () => {
  // JOB-01 — positional form
  it('positional form returns name, schedule, handler', () => {
    const job = defineJob('cleanup', '0 * * * *', async ({ command }) => {
      return { ok: true }
    })

    expect(job.name).toBe('cleanup')
    expect(job.schedule).toBe('0 * * * *')
    expect(typeof job.handler).toBe('function')
  })

  // JOB-02 — handler receives { command, log }
  it('handler receives { command, log } scope', async () => {
    let receivedCommand: unknown = null

    const job = defineJob('test-job', '* * * * *', async ({ command }) => {
      receivedCommand = command
      return { ok: true }
    })

    const fakeCommand = { cleanupDrafts: async () => ({}) }
    const fakeLog = { info: () => {} }
    const result = await job.handler({ command: fakeCommand, log: fakeLog } as any)

    expect(receivedCommand).toBe(fakeCommand)
    expect(result).toEqual({ ok: true })
  })

  // JOB-03 — object form
  it('object form works', () => {
    const job = defineJob({
      name: 'digest',
      schedule: '0 9 * * 1',
      handler: async ({ command }) => {
        return await command.sendDigest({ since_days: 7 })
      },
    })

    expect(job.name).toBe('digest')
    expect(job.schedule).toBe('0 9 * * 1')
    expect(typeof job.handler).toBe('function')
  })

  // JOB-04 — validates required fields
  it('throws on missing name', () => {
    expect(() => defineJob('', '0 * * * *', async () => {})).toThrow('Job name is required')
  })

  it('throws on missing schedule', () => {
    expect(() => defineJob('x', '', async () => {})).toThrow('Job schedule')
  })

  it('throws on missing handler', () => {
    expect(() => defineJob('x', '0 * * * *', null as any)).toThrow('Job handler must be a function')
  })
})
