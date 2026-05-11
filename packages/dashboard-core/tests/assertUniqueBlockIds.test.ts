// CC-F04 — assertUniqueBlockIds page-level collision detection.
// Pure-logic tests, no DOM.

import { describe, expect, it } from 'vitest'

import type { PageDef } from '../src/primitives'
import { assertUniqueBlockIds } from '../src/renderers/assertUniqueBlockIds'

describe('CC-F04 — assertUniqueBlockIds', () => {
  it('CC-F04-01: two blocks with the same id throw with a helpful message', () => {
    const spec: PageDef = {
      main: [
        { type: 'ChartCard', id: 'orders-chart' },
        { type: 'ChartCard', id: 'orders-chart' },
      ],
    }
    expect(() => assertUniqueBlockIds(spec)).toThrow(/Duplicate block id 'orders-chart'/)
    expect(() => assertUniqueBlockIds(spec)).toThrow(/range_orders-chart/)
    expect(() => assertUniqueBlockIds(spec)).toThrow(/ChartCard, ChartCard/)
  })

  it('CC-F04-02: two blocks with different ids do not throw', () => {
    const spec: PageDef = {
      main: [
        { type: 'ChartCard', id: 'orders-chart' },
        { type: 'ChartCard', id: 'revenue-chart' },
      ],
    }
    expect(() => assertUniqueBlockIds(spec)).not.toThrow()
  })

  it('CC-F04-03: blocks without ids are ignored (id is opt-in)', () => {
    const spec: PageDef = {
      main: [{ type: 'DataTable' }, { type: 'InfoCard' }, { type: 'StatsCard' }],
    }
    expect(() => assertUniqueBlockIds(spec)).not.toThrow()
  })

  it('CC-F04-04: three blocks where two share an id throw once', () => {
    const spec: PageDef = {
      main: [
        { type: 'ChartCard', id: 'orders-chart' },
        { type: 'StatsCard' },
        { type: 'ChartCard', id: 'orders-chart' },
      ],
    }
    let thrown = 0
    try {
      assertUniqueBlockIds(spec)
    } catch (_err) {
      thrown++
    }
    expect(thrown).toBe(1)
  })

  it('CC-F04-05: collision across main + sidebar is detected', () => {
    const spec: PageDef = {
      main: [{ type: 'ChartCard', id: 'shared' }],
      sidebar: [{ type: 'ChartCard', id: 'shared' }],
    }
    expect(() => assertUniqueBlockIds(spec)).toThrow(/Duplicate block id 'shared'/)
  })

  it('CC-F04-06: collision inside Card children is detected', () => {
    const spec: PageDef = {
      main: [
        { type: 'ChartCard', id: 'orders-chart' },
        {
          type: 'Card',
          children: [{ type: 'ChartCard', id: 'orders-chart' }],
        },
      ],
    }
    expect(() => assertUniqueBlockIds(spec)).toThrow(/Duplicate block id 'orders-chart'/)
  })

  it('CC-F04-07: empty-string id is treated as absent', () => {
    const spec: PageDef = {
      main: [
        { type: 'ChartCard', id: '' },
        { type: 'ChartCard', id: '' },
      ],
    }
    expect(() => assertUniqueBlockIds(spec)).not.toThrow()
  })
})
