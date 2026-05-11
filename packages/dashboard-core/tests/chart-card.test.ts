// CC — ChartCard descriptor types + applyRangeToQuery helper.
// Pure-logic tests only — no Recharts DOM rendering.

import { describe, expect, expectTypeOf, it } from 'vitest'

import { applyRangeToQuery, type ChartCardBlockProps, type ChartSeries } from '../src/blocks/ChartCard'
import type { UseBlockQueryResult } from '../src/blocks/use-block-query'
import type { BlockQueryDef, DateRangeValue, GraphQueryDef, NamedQueryDef } from '../src/primitives'

describe('CC — ChartCard descriptor types', () => {
  it('CC-01: ChartCardBlockProps compiles with minimal shape', () => {
    const descriptor: ChartCardBlockProps = {
      id: 'orders-trend',
      variant: 'line',
      xKey: 'day',
      series: [{ key: 'revenue', label: 'Revenue', color: 'chart-1' }],
    }
    expect(descriptor.id).toBe('orders-trend')
  })

  it('CC-02: ChartSeries.color accepts only chart-1..5 tokens', () => {
    const s: ChartSeries = { key: 'r', label: 'R', color: 'chart-5' }
    expect(s.color).toBe('chart-5')
    // @ts-expect-error — 'chart-6' is not in the union
    const bad: ChartSeries = { key: 'r', label: 'R', color: 'chart-6' }
    expect(bad.key).toBe('r')
  })
})

describe('CC — applyRangeToQuery helper', () => {
  const range: DateRangeValue = { kind: 'custom', from: '2025-01-01', to: '2025-01-31' }

  it('CC-03: GraphQueryDef gets range injected into graph.filters', () => {
    const q: GraphQueryDef = {
      graph: { entity: 'order', filters: { status: 'paid' } },
    }
    const merged = applyRangeToQuery(q, range, 'chart-1')
    expect(merged.graph.entity).toBe('order')
    expect(merged.graph.filters?.status).toBe('paid')
    expect(typeof merged.graph.filters?.from).toBe('string')
    expect(typeof merged.graph.filters?.to).toBe('string')
    // ISO format
    expect(String(merged.graph.filters?.from)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('CC-04: GraphQueryDef without prior filters still gets from/to', () => {
    const q: GraphQueryDef = { graph: { entity: 'order' } }
    const merged = applyRangeToQuery(q, range, 'chart-1')
    expect(merged.graph.filters?.from).toBeTruthy()
    expect(merged.graph.filters?.to).toBeTruthy()
  })

  it('CC-05: NamedQueryDef gets range + granularity into input', () => {
    const q: NamedQueryDef = { name: 'orders.timeseries', input: { warehouse: 'eu' } }
    const merged = applyRangeToQuery(q, range, 'chart-2', 'day')
    expect((merged as NamedQueryDef).input).toMatchObject({
      warehouse: 'eu',
      from: expect.any(String),
      to: expect.any(String),
      granularity: 'day',
    })
  })

  it('CC-06: NamedQueryDef without granularity omits the key', () => {
    const q: NamedQueryDef = { name: 'orders.timeseries' }
    const merged = applyRangeToQuery(q, range, 'chart-2')
    const input = (merged as NamedQueryDef).input as Record<string, unknown>
    expect('granularity' in input).toBe(false)
    expect(input.from).toBeTruthy()
    expect(input.to).toBeTruthy()
  })

  it('CC-07: preset range resolves to ISO strings (sanity)', () => {
    const q: GraphQueryDef = { graph: { entity: 'order' } }
    const merged = applyRangeToQuery(q, { kind: 'preset', preset: '7d' }, 'chart-3')
    expect(String(merged.graph.filters?.from)).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/)
    expect(String(merged.graph.filters?.to)).toMatch(/T23:59:59\.999Z$/)
  })

  it('CC-08: BlockQueryDef passthrough is type-stable', () => {
    const q: BlockQueryDef = { graph: { entity: 'order' } }
    const merged = applyRangeToQuery(q, range, 'chart-4')
    // Just ensure no TS regression — runtime check is trivial here.
    expect(merged).toBeDefined()
  })
})

describe('CC — UseBlockQueryResult.meta type contract', () => {
  it('CC-09: meta is an optional Record<string, unknown> on the result', () => {
    expectTypeOf<UseBlockQueryResult>().toHaveProperty('meta')
    // Optional — accepts undefined
    const ok: UseBlockQueryResult = {
      data: {},
      items: [],
      isLoading: false,
      error: null,
      refetch: () => {},
    }
    expect(ok.meta).toBeUndefined()
    const withMeta: UseBlockQueryResult = {
      data: {},
      items: [],
      meta: { range: { from: '2025-01-01', to: '2025-01-31' }, granularity: 'day' },
      isLoading: false,
      error: null,
      refetch: () => {},
    }
    expect(withMeta.meta?.granularity).toBe('day')
  })
})
