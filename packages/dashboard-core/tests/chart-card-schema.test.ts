// CC-F05 — Zod schema for ChartCardBlockProps.
// Runtime validation so AI assistants can validate their generated
// descriptors before emit.

import { describe, expect, it } from 'vitest'

import { chartCardBlockPropsSchema, dateRangeValueSchema } from '../src/blocks/ChartCard'

describe('CC-F05 — chartCardBlockPropsSchema', () => {
  it('CC-F05-01: valid line descriptor parses and round-trips', () => {
    const input = {
      id: 'orders-trend',
      variant: 'line' as const,
      xKey: 'day',
      series: [
        { key: 'revenue', label: 'Revenue', color: 'chart-1' as const, format: 'currency' as const },
        { key: 'orders', label: 'Orders', color: 'chart-2' as const },
      ],
    }
    const parsed = chartCardBlockPropsSchema.parse(input)
    expect(parsed).toEqual(input)
  })

  it('CC-F05-02: valid bar descriptor with stacked=true parses', () => {
    const input = {
      id: 'revenue-by-channel',
      variant: 'bar' as const,
      xKey: 'month',
      stacked: true,
      series: [
        { key: 'web', label: 'Web', color: 'chart-3' as const },
        { key: 'pos', label: 'POS', color: 'chart-4' as const },
      ],
    }
    const parsed = chartCardBlockPropsSchema.parse(input)
    expect(parsed.stacked).toBe(true)
    expect(parsed.variant).toBe('bar')
  })

  it('CC-F05-03: invalid color (red) fails with helpful error', () => {
    const input = {
      id: 'x',
      variant: 'line' as const,
      xKey: 'day',
      series: [{ key: 'r', label: 'R', color: 'red' }],
    }
    const result = chartCardBlockPropsSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = JSON.stringify(result.error.issues)
      expect(msg).toMatch(/chart-1|chart-2|chart-3|chart-4|chart-5|color/)
    }
  })

  it('CC-F05-04: missing required id fails', () => {
    const input = {
      variant: 'line' as const,
      xKey: 'day',
      series: [{ key: 'r', label: 'R' }],
    }
    const result = chartCardBlockPropsSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'id')).toBe(true)
    }
  })

  it('CC-F05-05: missing required series fails', () => {
    const input = {
      id: 'x',
      variant: 'line' as const,
      xKey: 'day',
    }
    const result = chartCardBlockPropsSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'series')).toBe(true)
    }
  })

  it('CC-F05-06: invalid variant (pie) fails', () => {
    const input = {
      id: 'x',
      variant: 'pie',
      xKey: 'day',
      series: [{ key: 'r', label: 'R' }],
    }
    const result = chartCardBlockPropsSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'variant')).toBe(true)
    }
  })

  it('CC-F05-07: custom range with invalid YYYY-MM-DD fails', () => {
    const input = {
      id: 'x',
      variant: 'line' as const,
      xKey: 'day',
      series: [{ key: 'r', label: 'R' }],
      defaultRange: { kind: 'custom', from: '2025/01/01', to: '2025-01-31' },
    }
    const result = chartCardBlockPropsSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths.some((p) => p.startsWith('defaultRange'))).toBe(true)
    }
  })

  it('CC-F05-08: single date kind round-trips through parse', () => {
    const value = { kind: 'date' as const, date: '2025-05-11' }
    const parsed = dateRangeValueSchema.parse(value)
    expect(parsed).toEqual(value)

    // Also round-trip via the full descriptor.
    const descriptor = {
      id: 'x',
      variant: 'line' as const,
      xKey: 'day',
      series: [{ key: 'r', label: 'R' }],
      defaultRange: value,
    }
    const full = chartCardBlockPropsSchema.parse(descriptor)
    expect(full.defaultRange).toEqual(value)
  })
})
