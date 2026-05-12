// ChartCard — autonomous chart block (line/area/bar) with URL-coupled
// date range. Owns its query, merges the resolved range into filters/input,
// renders via Recharts wrapped in shadcn ChartContainer.

import {
  Card,
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  DateRangePicker,
  type DateRangePreset,
  type DateRangeValue,
  parseRange,
  resolveRange,
  Skeleton,
  serializeRange,
} from '@manta/ui'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { z } from 'zod'

import type { BlockQueryDef, GraphQueryDef, NamedQueryDef } from '../primitives'
import { isGraphQuery, isNamedQuery } from '../primitives'
import { Heading, Text } from '../renderers/blocks/shared'
import { useBlockQuery } from './use-block-query'

// ── Public descriptor types ──────────────────────────────

export interface ChartSeries {
  key: string
  label: string
  color?: 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5'
  format?: 'number' | 'currency' | 'percent'
}

export interface ChartCardBlockProps {
  /**
   * Required, stable identifier — used to scope range state in the URL
   * (key `range_<id>`). Throwing on missing id is intentional: AI-safe
   * failure mode.
   */
  id: string
  variant: 'line' | 'area' | 'bar'
  query?: BlockQueryDef
  title?: string
  description?: string
  xKey: string
  xFormat?: 'date' | 'datetime' | 'month' | 'week'
  series: ChartSeries[]
  height?: number
  defaultRange?: DateRangeValue
  allowedPresets?: DateRangePreset[]
  allowCustom?: boolean
  stacked?: boolean
  granularity?: 'day' | 'week' | 'month'
  card?: boolean | { description?: string }
}

export type { DateRangePreset, DateRangeValue } from '@manta/ui'

// ── Zod schemas (runtime validation for AI-generated descriptors) ──
// Mirrors the types above exactly. A TS-level assertion at the bottom of
// this section keeps the inferred schema type in sync with the source-of-
// truth interfaces. NOTE: `query` is intentionally `z.unknown()` here —
// authoring a full BlockQueryDef Zod surface is out of scope (see CC-F05).

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const isoDate = z.string().regex(ISO_DATE_RE, 'Expected YYYY-MM-DD')

export const dateRangeValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preset'), preset: z.enum(['7d', '30d', '90d']) }),
  z.object({ kind: z.literal('custom'), from: isoDate, to: isoDate }),
  z.object({ kind: z.literal('date'), date: isoDate }),
])

export const chartSeriesSchema = z.object({
  key: z.string(),
  label: z.string(),
  color: z.enum(['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5']).optional(),
  format: z.enum(['number', 'currency', 'percent']).optional(),
})

export const chartCardBlockPropsSchema = z.object({
  id: z.string(),
  variant: z.enum(['line', 'area', 'bar']),
  query: z.unknown().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  xKey: z.string(),
  xFormat: z.enum(['date', 'datetime', 'month', 'week']).optional(),
  series: z.array(chartSeriesSchema),
  height: z.number().optional(),
  defaultRange: dateRangeValueSchema.optional(),
  allowedPresets: z.array(z.enum(['7d', '30d', '90d'])).optional(),
  allowCustom: z.boolean().optional(),
  stacked: z.boolean().optional(),
  granularity: z.enum(['day', 'week', 'month']).optional(),
  card: z.union([z.boolean(), z.object({ description: z.string().optional() })]).optional(),
})

// Structural sync guard: every field declared on `ChartCardBlockProps` must
// be assignable to the inferred schema shape. Asserted one-way only because
// `query` is intentionally widened to `unknown` in the schema (see comment
// above) — the reverse direction would require narrowing `unknown` →
// `BlockQueryDef`, which isn't valid without a full query schema (out of
// scope for CC-F05).
const _typeToSchema: z.infer<typeof chartCardBlockPropsSchema> = {} as ChartCardBlockProps
void _typeToSchema

// ── Query merge helper (exported for tests) ──────────────

/**
 * Merge a resolved DateRangeValue into a block query.
 *  - GraphQueryDef: range goes into `graph.filters` as { from: ISO, to: ISO }
 *  - NamedQueryDef: range goes into `input` as { from, to, granularity? }
 * blockId is currently informational — reserved for future per-block scoping.
 */
export function applyRangeToQuery<Q extends BlockQueryDef>(
  query: Q,
  range: DateRangeValue,
  _blockId: string,
  granularity?: 'day' | 'week' | 'month',
): Q {
  const { from, to } = resolveRange(range)
  const fromIso = from.toISOString()
  const toIso = to.toISOString()

  if (isGraphQuery(query)) {
    const next: GraphQueryDef = {
      graph: {
        ...query.graph,
        filters: {
          ...(query.graph.filters ?? {}),
          from: fromIso,
          to: toIso,
        },
      },
    }
    return next as Q
  }

  if (isNamedQuery(query)) {
    const input: Record<string, unknown> = {
      ...((query as NamedQueryDef).input ?? {}),
      from: fromIso,
      to: toIso,
    }
    if (granularity) input.granularity = granularity
    return { ...query, input } as Q
  }

  return query
}

// ── Component ────────────────────────────────────────────
// Duplicate `id` detection is page-level (see PageRenderer →
// assertUniqueBlockIds). The in-component warn was removed in CC-F04 so
// collisions throw before any chart renders, instead of warning per-mount.

const DEFAULT_RANGE: DateRangeValue = { kind: 'preset', preset: '30d' }
const DEFAULT_HEIGHT = 260
const DEFAULT_PRESETS: DateRangePreset[] = ['7d', '30d', '90d']

export function ChartCardBlock(props: ChartCardBlockProps) {
  if (!props.id) {
    throw new Error(
      "ChartCard requires a stable 'id'. Set 'id' in the block descriptor — this is used to scope range state in the URL (range_<id>).",
    )
  }

  const {
    id,
    variant,
    query,
    title,
    description,
    xKey,
    xFormat,
    series,
    height = DEFAULT_HEIGHT,
    defaultRange = DEFAULT_RANGE,
    allowedPresets = DEFAULT_PRESETS,
    allowCustom = true,
    stacked = false,
    granularity,
    card,
  } = props

  const [searchParams, setSearchParams] = useSearchParams()
  const rangeKey = `range_${id}`
  const rangeFromUrl = parseRange(searchParams.get(rangeKey))
  const range = rangeFromUrl ?? defaultRange

  const handleRangeChange = (next: DateRangeValue) => {
    const params = new URLSearchParams(searchParams)
    params.set(rangeKey, serializeRange(next))
    setSearchParams(params, { replace: true })
  }

  const mergedQuery = React.useMemo(() => {
    if (!query) return undefined
    return applyRangeToQuery(query, range, id, granularity)
  }, [query, range, id, granularity])

  const { items, isLoading } = useBlockQuery(mergedQuery)
  const rows = items as Record<string, unknown>[]

  // ── Build shadcn ChartConfig from series ──────────
  // Use `var(--chart-N)` directly. Tailwind v4 `@theme inline { --color-chart-N: var(--chart-N) }`
  // is a *utility-class mapping* — it does NOT emit `--color-chart-N` as a runtime CSS var, so
  // `var(--color-chart-N)` in inline styles resolves to nothing (SVG fill → black, stroke → none).
  const chartConfig: ChartConfig = React.useMemo(() => {
    const cfg: ChartConfig = {}
    for (let i = 0; i < series.length; i++) {
      const s = series[i]
      const colorToken = s.color ?? (`chart-${(i % 5) + 1}` as ChartSeries['color'])
      cfg[s.key] = {
        label: s.label,
        color: `var(--${colorToken})`,
      }
    }
    return cfg
  }, [series])

  const headerEl = (title || description || allowedPresets.length > 0 || allowCustom) && (
    <div className="flex items-center justify-between gap-x-4 px-6 py-4">
      <div className="flex flex-col gap-y-1 min-w-0">
        {title ? <Heading level="h2">{title}</Heading> : null}
        {description ? (
          <Text size="small" className="text-muted-foreground">
            {description}
          </Text>
        ) : null}
      </div>
      <div className="shrink-0">
        <DateRangePicker
          value={range}
          onChange={handleRangeChange}
          allowedPresets={allowedPresets}
          allowCustom={allowCustom}
        />
      </div>
    </div>
  )

  const bodyEl = (
    <div className="px-6 pb-6">
      {isLoading ? (
        <Skeleton style={{ height }} className="w-full" />
      ) : !rows || rows.length === 0 ? (
        <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
          Aucune donnée sur la période sélectionnée
        </div>
      ) : (
        <ChartContainer config={chartConfig} style={{ height, aspectRatio: 'auto' }}>
          {renderChart({ variant, rows, xKey, series, stacked, xFormat })}
        </ChartContainer>
      )}
    </div>
  )

  if (card === false) {
    return (
      <>
        {headerEl}
        {bodyEl}
      </>
    )
  }

  return (
    <Card className="divide-y p-0 overflow-hidden">
      {headerEl}
      {bodyEl}
    </Card>
  )
}

// ── Chart variant dispatcher ─────────────────────────────

type RenderArgs = {
  variant: ChartCardBlockProps['variant']
  rows: Record<string, unknown>[]
  xKey: string
  series: ChartSeries[]
  stacked: boolean
}

// Recharts ne réserve pas de place pour les tick labels si margin=0.
// On garde axisLine/tickLine off pour le look minimaliste mais on donne
// du gutter (left/bottom) pour que les valeurs et les dates s'affichent.
const CHART_MARGIN = { top: 8, right: 16, left: 16, bottom: 8 }

function formatXTick(value: unknown, xFormat: ChartCardBlockProps['xFormat']): string {
  if (value == null) return ''
  const str = String(value)
  if (!xFormat || xFormat === 'date' || xFormat === 'datetime') {
    // ISO date or datetime → format compact "DD/MM" in user locale
    const d = new Date(str)
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })
    }
  }
  return str
}

interface RenderArgs2 extends RenderArgs {
  xFormat?: ChartCardBlockProps['xFormat']
}

function renderChart({ variant, rows, xKey, series, stacked, xFormat }: RenderArgs2) {
  const tickFormatter = (v: unknown) => formatXTick(v, xFormat)

  const commonAxes = (
    <>
      <CartesianGrid vertical={false} strokeDasharray="3 3" />
      <XAxis
        dataKey={xKey}
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        minTickGap={32}
        tickFormatter={tickFormatter}
      />
      <YAxis tickLine={false} axisLine={false} tickMargin={8} width={40} allowDecimals={false} />
      <ChartTooltip
        cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
        content={<ChartTooltipContent indicator="line" />}
      />
      <ChartLegend content={<ChartLegendContent />} />
    </>
  )

  if (variant === 'line') {
    return (
      <LineChart data={rows} margin={CHART_MARGIN}>
        {commonAxes}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={`var(--color-${s.key})`}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    )
  }

  if (variant === 'area') {
    return (
      <AreaChart data={rows} margin={CHART_MARGIN}>
        {commonAxes}
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={`var(--color-${s.key})`}
            fill={`var(--color-${s.key})`}
            fillOpacity={0.2}
            stackId={stacked ? 'stack' : undefined}
            activeDot={{ r: 4 }}
          />
        ))}
      </AreaChart>
    )
  }

  // bar
  return (
    <BarChart data={rows} margin={CHART_MARGIN}>
      {commonAxes}
      {series.map((s) => (
        <Bar
          key={s.key}
          dataKey={s.key}
          fill={`var(--color-${s.key})`}
          radius={4}
          stackId={stacked ? 'stack' : undefined}
        />
      ))}
    </BarChart>
  )
}
