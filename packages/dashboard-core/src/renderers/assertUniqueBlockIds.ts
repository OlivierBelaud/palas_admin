// CC-F04 — Page-level block id collision detection.
//
// Some blocks (ChartCard) opt into a stable `id` to scope URL state
// (e.g. `range_<id>`). If two blocks on the same page share an `id`, the
// URL state is silently corrupted: changing the range on one chart moves
// the other one too. AI-generated specs are especially likely to produce
// duplicates, so we fail loudly at render time instead of `console.warn`.

import type { BlockDef, PageDef } from '../primitives'

interface Seen {
  id: string
  type: string
}

function collect(blocks: BlockDef[] | undefined, acc: Seen[]) {
  if (!blocks) return
  for (const block of blocks) {
    if (typeof block?.id === 'string' && block.id.length > 0) {
      acc.push({ id: block.id, type: block.type })
    }
    // Walk nested children (e.g. Card { children: BlockDef[] }).
    const children = (block as { children?: unknown }).children
    if (Array.isArray(children)) {
      collect(children as BlockDef[], acc)
    }
  }
}

/**
 * Throws if two blocks within `spec` share the same `id`. Only blocks that
 * opt into an `id` (e.g. ChartCard) are checked — blocks without an `id`
 * are ignored.
 */
export function assertUniqueBlockIds(spec: PageDef): void {
  const seen: Seen[] = []
  collect(spec.main, seen)
  collect(spec.sidebar, seen)

  const byId = new Map<string, string[]>()
  for (const entry of seen) {
    const existing = byId.get(entry.id)
    if (existing) {
      existing.push(entry.type)
    } else {
      byId.set(entry.id, [entry.type])
    }
  }

  for (const [id, types] of byId) {
    if (types.length > 1) {
      throw new Error(
        `Duplicate block id '${id}'. Block ids must be unique within a page — they scope URL state (e.g. range_${id}). Found in: ${types.join(', ')}.`,
      )
    }
  }
}
