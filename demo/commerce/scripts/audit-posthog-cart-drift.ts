// Read-only audit: compare the local `carts` snapshot table with the
// cart/checkout event truth in PostHog.
//
// Usage:
//   pnpm exec tsx scripts/audit-posthog-cart-drift.ts
//   pnpm exec tsx scripts/audit-posthog-cart-drift.ts --since 2026-06-01T00:00:00Z
//   pnpm exec tsx scripts/audit-posthog-cart-drift.ts --days 45 --json

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { type PosthogEvent, SPAM_EMAIL_RE } from '../src/modules/cart-tracking/apply-event'
import { normalizeCartEvent } from '../src/modules/cart-tracking/posthog-adapter'
import { parsePosthogProperties } from '../src/modules/cart-tracking/posthog-sync'
import { runPosthogHogQL } from '../src/utils/posthog-query'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const jsonOnly = args.includes('--json')

const STAGES = ['cart', 'checkout_started', 'checkout_engaged', 'payment_attempted', 'completed'] as const
const CHECKOUT_CART_BRIDGE_WINDOW_HOURS = 24
type Stage = (typeof STAGES)[number]

type LocalCart = {
  id: string
  cart_token: string | null
  distinct_id: string | null
  email: string | null
  total_price: string | number | null
  item_count: number | null
  currency: string | null
  last_action: string | null
  last_action_at: Date | string | null
  highest_stage: Stage | string | null
  status: string | null
  checkout_token: string | null
  shopify_order_id: string | null
  completed_at: Date | string | null
  cart_birth_at: Date | string | null
}

type ExpectedCart = {
  token: string
  base_token: string
  distinct_id: string | null
  email: string | null
  total_price: number
  item_count: number
  currency: string
  last_action: string
  last_action_at: string
  highest_stage: Stage
  status: string
  checkout_token: string | null
  shopify_order_id: string | null
  completed_at: string | null
  cart_birth_at: string
  event_count: number
  product_titles: string[]
}

type DriftIssue = {
  type: string
  severity: 'high' | 'medium' | 'low'
  cart_token: string
  local_id: string | null
  local: Record<string, unknown>
  expected: Record<string, unknown>
}

function loadEnv(rel: string, override: boolean): void {
  const full = resolve(here, '..', rel)
  try {
    const raw = readFileSync(full, 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (!override && process.env[m[1]]) continue
      let value = m[2].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      process.env[m[1]] = value
    }
  } catch {
    // optional env file
  }
}

function flagValue(name: string): string | null {
  const idx = args.indexOf(name)
  return idx === -1 ? null : (args[idx + 1] ?? null)
}

function auditSince(): string {
  const explicitSince = flagValue('--since')
  if (explicitSince) return new Date(explicitSince).toISOString()
  const daysRaw = flagValue('--days')
  if (daysRaw) {
    const days = Number(daysRaw)
    if (Number.isFinite(days) && days > 0) return new Date(Date.now() - days * 86_400_000).toISOString()
  }
  return '2026-03-01T00:00:00.000Z'
}

function baseToken(token: string | null | undefined): string | null {
  const trimmed = token?.trim()
  return trimmed ? trimmed.split('?')[0] : null
}

function stageFor(action: string): Stage {
  if (action.startsWith('cart:')) return 'cart'
  if (action === 'checkout:started') return 'checkout_started'
  if (action === 'checkout:payment_info_submitted') return 'payment_attempted'
  if (action === 'checkout:completed') return 'completed'
  return 'checkout_engaged'
}

function stageIndex(stage: string | null | undefined): number {
  return STAGES.indexOf(stage as Stage)
}

function firstNonNull<T>(current: T | null | undefined, incoming: T | null | undefined): T | null {
  if (current !== null && current !== undefined && current !== '') return current
  if (incoming !== null && incoming !== undefined && incoming !== '') return incoming
  return null
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function sameMoney(a: string | number | null | undefined, b: number | null | undefined): boolean {
  const left = toNumber(a)
  if (left == null || b == null) return left == null && b == null
  return Math.abs(left - b) < 0.01
}

function secondsApart(a: Date | string | null | undefined, b: string | null | undefined): number | null {
  const ai = toIso(a)
  if (!ai || !b) return null
  return Math.abs(new Date(ai).getTime() - new Date(b).getTime()) / 1000
}

function rowToEvent(row: unknown[]): PosthogEvent | null {
  const [uuid, event, distinctId, timestamp, properties] = row
  if (typeof event !== 'string' || typeof timestamp !== 'string') return null
  return {
    uuid: String(uuid ?? ''),
    event,
    distinct_id: distinctId == null ? null : String(distinctId),
    timestamp,
    properties: parsePosthogProperties(properties),
  }
}

function foldEvent(
  evt: PosthogEvent,
  carts: Map<string, ExpectedCart>,
  latestActiveTokenByDistinctId: Map<string, string>,
  spamTokens: Set<string>,
): 'folded' | 'skipped' {
  const n = normalizeCartEvent(evt)
  if (!n) return 'skipped'
  const incomingBaseToken = baseToken(n.cart_token) ?? n.cart_token
  if (spamTokens.has(incomingBaseToken) || (n.checkout_token && spamTokens.has(n.checkout_token))) return 'skipped'
  if (n.email && SPAM_EMAIL_RE.test(n.email)) {
    spamTokens.add(incomingBaseToken)
    if (n.checkout_token) spamTokens.add(n.checkout_token)
    carts.delete(incomingBaseToken)
    for (const [key, cart] of carts.entries()) {
      if (cart.checkout_token === n.checkout_token || cart.checkout_token === incomingBaseToken) carts.delete(key)
    }
    if (n.distinct_id) latestActiveTokenByDistinctId.delete(n.distinct_id)
    return 'skipped'
  }

  let token = n.cart_token
  const incomingBase = baseToken(token) ?? token
  const canonicalByBase = carts.get(incomingBase)?.token
  if (canonicalByBase) token = canonicalByBase

  if (!carts.has(baseToken(token) ?? token) && n.checkout_token) {
    const byCheckout = Array.from(carts.values()).find((cart) => cart.checkout_token === n.checkout_token)
    token = byCheckout?.token ?? token
  }
  if (!carts.has(baseToken(token) ?? token) && n.distinct_id && !n.event.startsWith('cart:')) {
    const latestToken = latestActiveTokenByDistinctId.get(n.distinct_id)
    const latestCart = latestToken ? carts.get(latestToken) : null
    if (latestCart && canBridgeCheckoutToCart(n.occurred_at, latestCart)) token = latestCart.token
  }

  const key = baseToken(token) ?? token
  const existing = carts.get(key)
  const newStage = stageFor(n.event)
  const titles = n.items
    .map((item) => (item && typeof item === 'object' ? (item as { title?: unknown }).title : null))
    .filter((title): title is string => typeof title === 'string' && title.length > 0)

  if (!existing) {
    const hasSignal = n.cart_has_payload && (n.items.length > 0 || n.total_price > 0)
    if (!hasSignal) return 'skipped'
    const expected: ExpectedCart = {
      token,
      base_token: key,
      distinct_id: n.distinct_id ?? null,
      email: n.email ?? null,
      total_price: n.cart_has_payload ? n.total_price : 0,
      item_count: n.cart_has_payload ? n.item_count : 0,
      currency: n.cart_has_payload ? n.currency : 'EUR',
      last_action: n.event,
      last_action_at: n.occurred_at,
      highest_stage: newStage,
      status: n.event === 'checkout:completed' ? 'completed' : 'active',
      checkout_token: n.checkout_token ?? null,
      shopify_order_id: n.shopify_order_id ?? null,
      completed_at: n.event === 'checkout:completed' ? n.occurred_at : null,
      cart_birth_at: n.occurred_at,
      event_count: 1,
      product_titles: Array.from(new Set(titles)),
    }
    carts.set(key, expected)
    if (n.distinct_id && expected.highest_stage !== 'completed') latestActiveTokenByDistinctId.set(n.distinct_id, key)
    return 'folded'
  }

  if (stageIndex(newStage) > stageIndex(existing.highest_stage)) existing.highest_stage = newStage
  if (n.event === 'checkout:completed') existing.status = 'completed'

  existing.distinct_id = firstNonNull(existing.distinct_id, n.distinct_id)
  existing.email = firstNonNull(existing.email, n.email)
  if (n.cart_has_payload) {
    existing.total_price = n.total_price
    existing.item_count = n.item_count
    existing.currency = n.currency
  }
  existing.checkout_token = firstNonNull(existing.checkout_token, n.checkout_token)
  existing.shopify_order_id = firstNonNull(existing.shopify_order_id, n.shopify_order_id)
  if (n.event === 'checkout:completed') existing.completed_at = firstNonNull(existing.completed_at, n.occurred_at)
  existing.last_action = n.event
  existing.last_action_at = n.occurred_at
  existing.event_count += 1
  existing.product_titles = Array.from(new Set([...existing.product_titles, ...titles]))
  if (n.distinct_id) {
    if (existing.highest_stage === 'completed') latestActiveTokenByDistinctId.delete(n.distinct_id)
    else latestActiveTokenByDistinctId.set(n.distinct_id, key)
  }
  return 'folded'
}

function canBridgeCheckoutToCart(checkoutOccurredAt: string, cart: ExpectedCart): boolean {
  if (cart.highest_stage === 'completed') return false
  const checkoutMs = new Date(checkoutOccurredAt).getTime()
  const cartMs = new Date(cart.last_action_at).getTime()
  if (!Number.isFinite(checkoutMs) || !Number.isFinite(cartMs)) return false
  return (
    cartMs >= checkoutMs - CHECKOUT_CART_BRIDGE_WINDOW_HOURS * 60 * 60 * 1000 && cartMs <= checkoutMs + 10 * 60 * 1000
  )
}

async function hogql(query: string): Promise<unknown[][]> {
  return runPosthogHogQL(query, {
    privateKey: process.env.POSTHOG_PERSONAL_API_KEY ?? process.env.POSTHOG_API_KEY,
    refresh: 'force_blocking',
  })
}

loadEnv('.env', false)
loadEnv('.env.local', true)
loadEnv('.env.production', false)

const sinceIso = auditSince()
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL missing')
if (!process.env.POSTHOG_API_KEY && !process.env.POSTHOG_PERSONAL_API_KEY) throw new Error('POSTHOG_API_KEY missing')

const sql = postgres(databaseUrl, {
  ssl: /neon\.tech/.test(databaseUrl) ? 'require' : undefined,
  max: 4,
  prepare: false,
})

const expected = new Map<string, ExpectedCart>()
const latestActiveTokenByDistinctId = new Map<string, string>()
const spamTokens = new Set<string>()
let eventsRead = 0
let eventsFolded = 0
let eventsSkipped = 0
let decodedDropped = 0
let offset = 0
const pageSize = 1000

try {
  while (true) {
    const rows = await hogql(`
      SELECT uuid, event, distinct_id, timestamp, properties
      FROM events
      WHERE timestamp >= toDateTime('${sinceIso}')
        AND (event LIKE 'cart:%' OR event LIKE 'checkout:%')
      ORDER BY timestamp ASC, uuid ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `)
    if (rows.length === 0) break
    eventsRead += rows.length

    for (const row of rows) {
      const evt = rowToEvent(row)
      if (!evt) {
        decodedDropped += 1
        continue
      }
      const outcome = foldEvent(evt, expected, latestActiveTokenByDistinctId, spamTokens)
      if (outcome === 'folded') eventsFolded += 1
      else eventsSkipped += 1
    }

    if (!jsonOnly) {
      console.log(`read=${eventsRead} folded=${eventsFolded} expected_carts=${expected.size}`)
    }
    offset += rows.length
    if (rows.length < pageSize) break
  }

  const localRows = await sql<LocalCart[]>`
    SELECT id, cart_token, distinct_id, email, total_price::text AS total_price, item_count,
           currency, last_action, last_action_at, highest_stage, status, checkout_token,
           shopify_order_id, completed_at, cart_birth_at
      FROM carts
     WHERE last_action_at >= ${sinceIso}::timestamptz
        OR cart_birth_at >= ${sinceIso}::timestamptz
  `

  const localByKey = new Map<string, LocalCart[]>()
  const addLocalKey = (key: string | null, cart: LocalCart) => {
    if (!key) return
    const list = localByKey.get(key) ?? []
    if (!list.some((item) => item.id === cart.id)) list.push(cart)
    localByKey.set(key, list)
  }
  for (const cart of localRows) {
    addLocalKey(baseToken(cart.cart_token), cart)
    addLocalKey(cart.checkout_token, cart)
  }

  const issues: DriftIssue[] = []
  const addIssue = (
    type: string,
    severity: DriftIssue['severity'],
    expectedCart: ExpectedCart,
    local: LocalCart | null,
    localFields: Record<string, unknown>,
    expectedFields: Record<string, unknown>,
  ) => {
    issues.push({
      type,
      severity,
      cart_token: expectedCart.base_token,
      local_id: local?.id ?? null,
      local: localFields,
      expected: expectedFields,
    })
  }

  for (const expectedCart of expected.values()) {
    const locals = [
      ...(localByKey.get(expectedCart.base_token) ?? []),
      ...(expectedCart.checkout_token ? (localByKey.get(expectedCart.checkout_token) ?? []) : []),
    ].filter((cart, index, list) => list.findIndex((item) => item.id === cart.id) === index)
    if (locals.length === 0) {
      addIssue('missing_local_cart', 'high', expectedCart, null, {}, summarizeExpected(expectedCart))
      continue
    }
    const exactLocals = locals.filter((cart) => baseToken(cart.cart_token) === expectedCart.base_token)
    if (exactLocals.length > 1) {
      addIssue(
        'duplicate_local_base_token',
        'high',
        expectedCart,
        exactLocals[0],
        { ids: exactLocals.map((cart) => cart.id) },
        summarizeExpected(expectedCart),
      )
    }

    const local = locals.slice().sort((a, b) => {
      const stageDelta = stageIndex(b.highest_stage) - stageIndex(a.highest_stage)
      if (stageDelta !== 0) return stageDelta
      const aExact = baseToken(a.cart_token) === expectedCart.base_token ? 1 : 0
      const bExact = baseToken(b.cart_token) === expectedCart.base_token ? 1 : 0
      if (aExact !== bExact) return bExact - aExact
      return new Date(toIso(b.last_action_at) ?? 0).getTime() - new Date(toIso(a.last_action_at) ?? 0).getTime()
    })[0]
    const localStageIdx = stageIndex(local.highest_stage)
    const expectedStageIdx = stageIndex(expectedCart.highest_stage)
    const matchedByCheckoutAlias = exactLocals.length === 0
    const localTime = new Date(toIso(local.last_action_at) ?? 0).getTime()
    const expectedTime = new Date(expectedCart.last_action_at).getTime()
    const localCoversExpected =
      localStageIdx >= expectedStageIdx &&
      localTime >= expectedTime &&
      (matchedByCheckoutAlias || localStageIdx > expectedStageIdx)
    if (localStageIdx < expectedStageIdx) {
      addIssue(
        'stage_lag',
        'high',
        expectedCart,
        local,
        {
          highest_stage: local.highest_stage,
          last_action: local.last_action,
          last_action_at: toIso(local.last_action_at),
        },
        {
          highest_stage: expectedCart.highest_stage,
          last_action: expectedCart.last_action,
          last_action_at: expectedCart.last_action_at,
        },
      )
    }

    const delta = secondsApart(local.last_action_at, expectedCart.last_action_at)
    if (!localCoversExpected && (delta == null || delta > 2 || local.last_action !== expectedCart.last_action)) {
      addIssue(
        'last_action_drift',
        delta != null && delta <= 120 ? 'medium' : 'high',
        expectedCart,
        local,
        { last_action: local.last_action, last_action_at: toIso(local.last_action_at) },
        { last_action: expectedCart.last_action, last_action_at: expectedCart.last_action_at, delta_seconds: delta },
      )
    }

    if (!localCoversExpected && !sameMoney(local.total_price, expectedCart.total_price)) {
      addIssue(
        'total_price_drift',
        'medium',
        expectedCart,
        local,
        { total_price: local.total_price, item_count: local.item_count },
        { total_price: expectedCart.total_price, item_count: expectedCart.item_count },
      )
    }

    if (!localCoversExpected && (local.item_count ?? null) !== expectedCart.item_count) {
      addIssue(
        'item_count_drift',
        'medium',
        expectedCart,
        local,
        { item_count: local.item_count },
        { item_count: expectedCart.item_count },
      )
    }

    if (!localCoversExpected && expectedCart.email && local.email?.toLowerCase() !== expectedCart.email.toLowerCase()) {
      addIssue('email_drift', 'medium', expectedCart, local, { email: local.email }, { email: expectedCart.email })
    }

    if (expectedCart.shopify_order_id && local.shopify_order_id !== expectedCart.shopify_order_id) {
      addIssue(
        'shopify_order_drift',
        'high',
        expectedCart,
        local,
        { shopify_order_id: local.shopify_order_id },
        { shopify_order_id: expectedCart.shopify_order_id },
      )
    }

    if (expectedCart.status === 'completed' && local.status !== 'completed') {
      addIssue('status_drift', 'high', expectedCart, local, { status: local.status }, { status: expectedCart.status })
    }
  }

  const issueCounts = issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.type] = (acc[issue.type] ?? 0) + 1
    return acc
  }, {})
  const highIssues = issues.filter((issue) => issue.severity === 'high')
  const cartsWithIssues = new Set(issues.map((issue) => issue.cart_token))
  const highCartsWithIssues = new Set(highIssues.map((issue) => issue.cart_token))

  const report = {
    since: sinceIso,
    events: {
      read: eventsRead,
      folded: eventsFolded,
      skipped: eventsSkipped,
      decoded_dropped: decodedDropped,
    },
    carts: {
      expected_from_posthog: expected.size,
      local_in_window: localRows.length,
      with_any_issue: cartsWithIssues.size,
      with_high_issue: highCartsWithIssues.size,
    },
    issue_counts: issueCounts,
    examples: issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity)).slice(0, 30),
  }

  console.log(JSON.stringify(report, null, 2))
} finally {
  await sql.end({ timeout: 5 })
}

function summarizeExpected(cart: ExpectedCart): Record<string, unknown> {
  return {
    distinct_id: cart.distinct_id,
    email: cart.email,
    total_price: cart.total_price,
    item_count: cart.item_count,
    last_action: cart.last_action,
    last_action_at: cart.last_action_at,
    highest_stage: cart.highest_stage,
    status: cart.status,
    checkout_token: cart.checkout_token,
    shopify_order_id: cart.shopify_order_id,
    event_count: cart.event_count,
    products: cart.product_titles.slice(0, 5),
  }
}

function severityRank(severity: DriftIssue['severity']): number {
  if (severity === 'high') return 3
  if (severity === 'medium') return 2
  return 1
}
