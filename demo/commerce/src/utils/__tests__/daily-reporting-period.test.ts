import { describe, expect, it } from 'vitest'
import { parisDayWindow, previousParisDay } from '../daily-reporting'

describe('daily reporting Paris periods', () => {
  it('uses the previous calendar day in Europe/Paris', () => {
    expect(previousParisDay(new Date('2026-07-22T00:30:00.000Z'))).toBe('2026-07-21')
    expect(previousParisDay(new Date('2026-01-01T00:30:00.000Z'))).toBe('2025-12-31')
  })

  it('keeps the 23-hour spring DST day', () => {
    const { start, end } = parisDayWindow('2026-03-29')

    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z')
    expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z')
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000)
  })

  it('keeps the 25-hour autumn DST day', () => {
    const { start, end } = parisDayWindow('2026-10-25')

    expect(start.toISOString()).toBe('2026-10-24T22:00:00.000Z')
    expect(end.toISOString()).toBe('2026-10-25T23:00:00.000Z')
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000)
  })

  it.each(['2026-02-30', '2026-13-01', '2026-01-00', 'not-a-day', '2026-1-01'])(
    'rejects an invalid reporting day: %s',
    (day) => {
      expect(() => parisDayWindow(day)).toThrow(`Invalid reporting day: ${day}`)
    },
  )
})
