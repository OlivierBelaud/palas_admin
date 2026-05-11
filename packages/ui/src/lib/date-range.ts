// Date range value + URL serialization helpers for ChartCard.
// Pure functions — no React, no DOM, no time-zone-sensitive math
// beyond UTC anchoring. Three encodings:
//  - preset:  "7d" | "30d" | "90d"
//  - custom:  "YYYY-MM-DD..YYYY-MM-DD"
//  - date:    "YYYY-MM-DD"

export type DateRangePreset = '7d' | '30d' | '90d'

export type DateRangeValue =
  | { kind: 'preset'; preset: DateRangePreset }
  | { kind: 'custom'; from: string; to: string }
  | { kind: 'date'; date: string }

export const RANGE_PRESETS: ReadonlyArray<{ value: DateRangePreset; label: string; days: number }> = [
  { value: '7d', label: '7 derniers jours', days: 7 },
  { value: '30d', label: '30 derniers jours', days: 30 },
  { value: '90d', label: '90 derniers jours', days: 90 },
]

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return false
  // Round-trip check guards against e.g. "2025-02-31"
  return d.toISOString().slice(0, 10) === s
}

/**
 * Parse a serialized range string (typically from URL).
 * Returns undefined for null/empty/invalid input.
 */
export function parseRange(s: string | null | undefined): DateRangeValue | undefined {
  if (!s) return undefined
  // Preset?
  for (const p of RANGE_PRESETS) {
    if (s === p.value) return { kind: 'preset', preset: p.value }
  }
  // Custom range?
  if (s.includes('..')) {
    const [from, to] = s.split('..')
    if (!isValidIsoDate(from) || !isValidIsoDate(to)) return undefined
    // Clamp: if to < from, swap so callers always get to >= from.
    if (to < from) return { kind: 'custom', from: to, to: from }
    return { kind: 'custom', from, to }
  }
  // Single date?
  if (isValidIsoDate(s)) return { kind: 'date', date: s }
  return undefined
}

/**
 * Serialize a range to a stable string suitable for URL storage.
 */
export function serializeRange(r: DateRangeValue): string {
  if (r.kind === 'preset') return r.preset
  if (r.kind === 'date') return r.date
  // custom — defensive swap to keep to >= from
  if (r.to < r.from) return `${r.to}..${r.from}`
  return `${r.from}..${r.to}`
}

/**
 * Resolve a DateRangeValue into concrete Date bounds.
 * - presets anchor `to` to end-of-day UTC of `now`, `from` = `to` - N days.
 * - custom: from = 00:00:00 UTC of `from`, to = 23:59:59.999 UTC of `to`.
 * - date: from = 00:00:00 UTC, to = 23:59:59.999 UTC same day.
 */
export function resolveRange(r: DateRangeValue, now: Date = new Date()): { from: Date; to: Date } {
  if (r.kind === 'preset') {
    const days = RANGE_PRESETS.find((p) => p.value === r.preset)?.days ?? 30
    const to = endOfUtcDay(now)
    const from = new Date(to.getTime() - days * 86_400_000 + 1)
    // Anchor `from` to start-of-day UTC for predictable buckets
    const fromStart = startOfUtcDay(from)
    return { from: fromStart, to }
  }
  if (r.kind === 'date') {
    const base = new Date(`${r.date}T00:00:00.000Z`)
    return { from: startOfUtcDay(base), to: endOfUtcDay(base) }
  }
  // custom
  const fromRaw = new Date(`${r.from}T00:00:00.000Z`)
  const toRaw = new Date(`${r.to}T00:00:00.000Z`)
  let from = startOfUtcDay(fromRaw)
  let to = endOfUtcDay(toRaw)
  if (to.getTime() < from.getTime()) {
    const swap = from
    from = startOfUtcDay(toRaw)
    to = endOfUtcDay(swap)
  }
  return { from, to }
}

/**
 * Human-readable label for a range, suitable for the picker button.
 */
export function formatRangeLabel(r: DateRangeValue): string {
  if (r.kind === 'preset') {
    return RANGE_PRESETS.find((p) => p.value === r.preset)?.label ?? r.preset
  }
  if (r.kind === 'date') return r.date
  return `${r.from} → ${r.to}`
}

// ── internals ───────────────────────────────────────────

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999))
}
