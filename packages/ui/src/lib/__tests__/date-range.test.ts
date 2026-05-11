// DR — date-range parser/serializer round-trip + resolveRange clamping.

import { describe, expect, it } from 'vitest'
import {
  type DateRangeValue,
  formatRangeLabel,
  parseRange,
  RANGE_PRESETS,
  resolveRange,
  serializeRange,
} from '../date-range'

describe('DR — date-range', () => {
  it('DR-01: presets round-trip', () => {
    for (const p of RANGE_PRESETS) {
      const v: DateRangeValue = { kind: 'preset', preset: p.value }
      const s = serializeRange(v)
      expect(s).toBe(p.value)
      expect(parseRange(s)).toEqual(v)
    }
  })

  it('DR-02: custom range round-trips', () => {
    const v: DateRangeValue = { kind: 'custom', from: '2025-01-01', to: '2025-02-15' }
    const s = serializeRange(v)
    expect(s).toBe('2025-01-01..2025-02-15')
    expect(parseRange(s)).toEqual(v)
  })

  it('DR-03: single date round-trips', () => {
    const v: DateRangeValue = { kind: 'date', date: '2025-05-11' }
    const s = serializeRange(v)
    expect(s).toBe('2025-05-11')
    expect(parseRange(s)).toEqual(v)
  })

  it('DR-04: invalid input returns undefined', () => {
    expect(parseRange(null)).toBeUndefined()
    expect(parseRange('')).toBeUndefined()
    expect(parseRange(undefined)).toBeUndefined()
    expect(parseRange('garbage')).toBeUndefined()
    expect(parseRange('2025-13-01')).toBeUndefined() // bad month
    expect(parseRange('2025-02-31')).toBeUndefined() // not a real day
    expect(parseRange('not..a..range')).toBeUndefined()
    expect(parseRange('2025-01-01..bogus')).toBeUndefined()
  })

  it('DR-05: parseRange clamps to >= from for inverted custom input', () => {
    const r = parseRange('2025-03-10..2025-03-01')
    expect(r).toEqual({ kind: 'custom', from: '2025-03-01', to: '2025-03-10' })
  })

  it('DR-06: resolveRange clamps to >= from for inverted value', () => {
    const v: DateRangeValue = { kind: 'custom', from: '2025-03-10', to: '2025-03-01' }
    const { from, to } = resolveRange(v)
    expect(to.getTime() >= from.getTime()).toBe(true)
  })

  it('DR-07: resolveRange anchors `to` to end-of-day UTC for presets', () => {
    const now = new Date('2025-05-11T08:30:00.000Z')
    const { from, to } = resolveRange({ kind: 'preset', preset: '7d' }, now)
    expect(to.toISOString().endsWith('T23:59:59.999Z')).toBe(true)
    expect(from.toISOString().endsWith('T00:00:00.000Z')).toBe(true)
    // 7-day window anchored on 2025-05-11 UTC end-of-day
    expect(to.toISOString().slice(0, 10)).toBe('2025-05-11')
  })

  it('DR-08: resolveRange honors date kind', () => {
    const { from, to } = resolveRange({ kind: 'date', date: '2025-05-11' })
    expect(from.toISOString()).toBe('2025-05-11T00:00:00.000Z')
    expect(to.toISOString()).toBe('2025-05-11T23:59:59.999Z')
  })

  it('DR-09: formatRangeLabel returns readable string for each kind', () => {
    expect(formatRangeLabel({ kind: 'preset', preset: '30d' })).toContain('30')
    expect(formatRangeLabel({ kind: 'date', date: '2025-05-11' })).toBe('2025-05-11')
    expect(formatRangeLabel({ kind: 'custom', from: '2025-01-01', to: '2025-02-01' })).toBe('2025-01-01 → 2025-02-01')
  })
})
