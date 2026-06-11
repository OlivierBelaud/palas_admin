import { pickLocale } from '../emails/abandoned-cart/pick-locale'
import { renderAbandonedCart } from '../emails/abandoned-cart/render'
import { ShopifyAdminClient } from '../modules/shopify-admin/client'
import { type DiscountGrant, resolveWelcomeDiscountForEmail } from './discount-codes'
import { archiveEmailSnapshot, type EmailSnapshotResult } from './email-snapshot'
import type { RuntimeFilePort, RuntimeNotificationPort, RuntimeSql } from './manta-runtime'
import { sendPosthogEvent } from './posthog-ingest'
import { buildRecoveryUrl } from './recovery-url'
import { signUnsubscribeToken } from './unsubscribe-token'

type CaseType = 'cart_abandoned' | 'checkout_abandoned' | 'payment_help'
type MessageType = 'abandoned_cart_1' | 'abandoned_cart_2' | 'abandoned_cart_3' | 'payment_help_1'
type SkipReason =
  | 'shopify_order_found'
  | 'klaviyo_email_found'
  | 'opt_out'
  | 'no_products'
  | 'shopify_check_unavailable'
  | 'send_error'

export interface AbandonedCartCampaignOptions {
  sql: RuntimeSql
  notification: RuntimeNotificationPort
  file?: RuntimeFilePort | null
  adminBase: string
  fromEmail: string
  replyTo?: string
  batchLimit?: number
  dryRun?: boolean
  checkKlaviyo?: boolean
  maxCaseAgeDays?: number
  recoveryWindowDays?: number
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void }
}

export interface AbandonedCartCampaignResult {
  scanned: number
  due: number
  sent: number
  skipped: number
  skipped_optout: number
  skipped_no_products: number
  skipped_shopify_order: number
  skipped_shopify_unavailable: number
  skipped_klaviyo: number
  recovered: number
  errors: number
}

interface CandidateRow {
  id: string
  cart_token: string
  checkout_token: string | null
  distinct_id: string | null
  email: string
  first_name: string | null
  country_code: string | null
  browser_locale: string | null
  items: unknown
  total_price: number | null
  currency: string | null
  last_action_at: Date | string
  highest_stage: string
  contact_id: string | null
  contact_locale: string | null
  contact_orders_count: number | null
  email_marketing_opt_out_at: Date | string | null
  klaviyo_suppressed: boolean | null
}

interface CaseRow {
  id: string
  status: string
}

interface MessageRow {
  id: string
  message_type: MessageType | 'klaviyo_abandoned'
  status: 'pending' | 'sent' | 'skipped' | 'failed'
  sent_at: Date | string | null
  scheduled_for: Date | string
}

interface ShopifyOrderMatch {
  id: string
  name: string | null
  createdAt: string
  total: number | null
  currency: string | null
}

interface RenderedMessage {
  subject: string
  html: string
  text: string
  locale: string
  recoveryUrl: string
  unsubscribeUrl: string
  discountGrant: DiscountGrant | null
}

const HOUR_MS = 3600 * 1000
const DAY_MS = 24 * HOUR_MS
const FIRST_ABANDONED_AFTER_HOURS = 2
const PAYMENT_HELP_AFTER_HOURS = 1
const NEXT_EMAIL_AFTER_DAYS = 2
const DEFAULT_MAX_CASE_AGE_DAYS = 14
const DEFAULT_RECOVERY_WINDOW_DAYS = 7
const KLAVIYO_ABANDON_METRICS = ['Shopify_Checkout_Abandonned', 'Checkout Abandoned']
const GWP_TITLE_RX = /\b(?:gift|offert|free|charm offert)\b/i

function newId(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  return `${prefix}_${random}`
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function dueAt(base: Date | string, ms: number): Date {
  return new Date(toDate(base).getTime() + ms)
}

function caseTypeForStage(stage: string): CaseType {
  if (stage === 'payment_attempted') return 'payment_help'
  if (stage === 'checkout_started' || stage === 'checkout_engaged') return 'checkout_abandoned'
  return 'cart_abandoned'
}

function coerceItems(raw: unknown) {
  if (!Array.isArray(raw)) return []
  const map = new Map<
    string,
    {
      id: string | number | null
      title: string
      quantity: number
      image_url: string | null
      line_price?: number | null
    }
  >()
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title : ''
    if (GWP_TITLE_RX.test(title)) continue
    const rawId = typeof o.id === 'string' || typeof o.id === 'number' ? o.id : null
    const key = rawId !== null ? String(rawId) : `__no_id_${map.size}`
    const qty = typeof o.quantity === 'number' && Number.isFinite(o.quantity) ? o.quantity : 1
    const linePrice =
      typeof o.line_price === 'number' && o.line_price > 0
        ? o.line_price
        : typeof o.price === 'number' && o.price > 0
          ? o.price
          : null
    const existing = map.get(key)
    if (existing) {
      existing.quantity += qty
      if (!existing.image_url && typeof o.image_url === 'string') existing.image_url = o.image_url
      if (typeof linePrice === 'number') existing.line_price = (existing.line_price ?? 0) + linePrice
      continue
    }
    map.set(key, {
      id: rawId,
      title,
      quantity: qty,
      image_url: typeof o.image_url === 'string' ? o.image_url : null,
      line_price: linePrice,
    })
  }
  return Array.from(map.values())
}

function nextMessage(
  c: CandidateRow,
  messages: MessageRow[],
  now: Date,
): { type: MessageType; scheduledFor: Date } | null {
  const sent = new Map(messages.filter((m) => m.status === 'sent').map((m) => [m.message_type, m]))
  const hasAny = (type: MessageType) => messages.some((m) => m.message_type === type)

  if (c.highest_stage === 'payment_attempted') {
    const scheduledFor = dueAt(c.last_action_at, PAYMENT_HELP_AFTER_HOURS * HOUR_MS)
    if (!hasAny('payment_help_1') && scheduledFor.getTime() <= now.getTime())
      return { type: 'payment_help_1', scheduledFor }
    return null
  }

  const firstScheduledFor = dueAt(c.last_action_at, FIRST_ABANDONED_AFTER_HOURS * HOUR_MS)
  if (!hasAny('abandoned_cart_1') && firstScheduledFor.getTime() <= now.getTime()) {
    return { type: 'abandoned_cart_1', scheduledFor: firstScheduledFor }
  }

  const first = sent.get('abandoned_cart_1')
  const second = sent.get('abandoned_cart_2')
  if (first && !hasAny('abandoned_cart_2')) {
    const scheduledFor = dueAt(first.sent_at ?? first.scheduled_for, NEXT_EMAIL_AFTER_DAYS * DAY_MS)
    if (scheduledFor.getTime() <= now.getTime()) return { type: 'abandoned_cart_2', scheduledFor }
  }
  if (second && !hasAny('abandoned_cart_3')) {
    const scheduledFor = dueAt(second.sent_at ?? second.scheduled_for, NEXT_EMAIL_AFTER_DAYS * DAY_MS)
    if (scheduledFor.getTime() <= now.getTime()) return { type: 'abandoned_cart_3', scheduledFor }
  }
  return null
}

async function ensureCase(sql: RuntimeSql, c: CandidateRow): Promise<CaseRow> {
  const rows = await sql<CaseRow[]>`
    INSERT INTO abandoned_cart_cases (
      id, cart_id, contact_id, email, cart_token, checkout_token, case_type, status,
      stage_at_open, last_cart_action_at, opened_at, created_at, updated_at
    )
    VALUES (
      ${newId('acc')}, ${c.id}, ${c.contact_id}, ${c.email.toLowerCase()}, ${c.cart_token}, ${c.checkout_token},
      ${caseTypeForStage(c.highest_stage)}, 'open', ${c.highest_stage}, ${toDate(c.last_action_at)}, NOW(), NOW(), NOW()
    )
    ON CONFLICT (cart_id) DO UPDATE SET
      contact_id = COALESCE(EXCLUDED.contact_id, abandoned_cart_cases.contact_id),
      email = EXCLUDED.email,
      cart_token = EXCLUDED.cart_token,
      checkout_token = EXCLUDED.checkout_token,
      last_cart_action_at = EXCLUDED.last_cart_action_at,
      updated_at = NOW()
    RETURNING id, status`
  return rows[0]
}

async function loadMessages(sql: RuntimeSql, caseId: string): Promise<MessageRow[]> {
  return await sql<MessageRow[]>`
    SELECT id, message_type, status, sent_at, scheduled_for
    FROM abandoned_cart_messages
    WHERE case_id = ${caseId}
    ORDER BY scheduled_for ASC, created_at ASC`
}

async function createPendingMessage(
  sql: RuntimeSql,
  c: CandidateRow,
  caseId: string,
  type: MessageType,
  scheduledFor: Date,
): Promise<MessageRow> {
  const rows = await sql<MessageRow[]>`
    INSERT INTO abandoned_cart_messages (
      id, case_id, cart_id, email, message_type, status, scheduled_for, created_at, updated_at
    )
    VALUES (${newId('acm')}, ${caseId}, ${c.id}, ${c.email.toLowerCase()}, ${type}, 'pending', ${scheduledFor}, NOW(), NOW())
    ON CONFLICT (case_id, message_type) DO UPDATE SET
      scheduled_for = EXCLUDED.scheduled_for,
      updated_at = NOW()
    WHERE abandoned_cart_messages.status = 'pending'
    RETURNING id, message_type, status, sent_at, scheduled_for`
  if (rows[0]) return rows[0]
  const existing = await sql<MessageRow[]>`
    SELECT id, message_type, status, sent_at, scheduled_for
    FROM abandoned_cart_messages
    WHERE case_id = ${caseId} AND message_type = ${type}
    LIMIT 1`
  return existing[0]
}

async function logCheck(
  sql: RuntimeSql,
  caseId: string,
  messageId: string | null,
  checkType: 'shopify_order' | 'klaviyo_email' | 'opt_out',
  status: 'passed' | 'blocked' | 'error' | 'unknown',
  rawSummary?: string | null,
): Promise<void> {
  await sql`
    INSERT INTO abandoned_cart_checks (
      id, case_id, message_id, check_type, status, raw_summary, checked_at, created_at, updated_at
    )
    VALUES (${newId('acc_check')}, ${caseId}, ${messageId}, ${checkType}, ${status}, ${rawSummary ?? null}, NOW(), NOW(), NOW())`
}

async function markSkipped(
  sql: RuntimeSql,
  caseId: string,
  messageId: string,
  reason: SkipReason,
  errorMessage?: string | null,
): Promise<void> {
  await sql`
    UPDATE abandoned_cart_messages
    SET status = 'skipped',
        skip_reason = ${reason},
        error_message = ${errorMessage ?? null},
        updated_at = NOW()
    WHERE id = ${messageId}`

  if (reason === 'shopify_order_found') {
    await sql`
      UPDATE abandoned_cart_cases
      SET status = 'closed_order_found', updated_at = NOW()
      WHERE id = ${caseId} AND status = 'open'`
  }
  if (reason === 'opt_out') {
    await sql`
      UPDATE abandoned_cart_cases
      SET status = 'closed_unsubscribed', updated_at = NOW()
      WHERE id = ${caseId} AND status = 'open'`
  }
}

async function markSent(
  sql: RuntimeSql,
  c: CandidateRow,
  messageId: string,
  messageType: MessageType,
  rendered: RenderedMessage,
  providerMessageId: string | undefined,
  idempotencyKey: string,
  snapshot: EmailSnapshotResult | null,
): Promise<void> {
  await sql`
    UPDATE abandoned_cart_messages
    SET status = 'sent',
        sent_at = NOW(),
        provider = 'resend',
        provider_message_id = ${providerMessageId ?? null},
        template_key = ${messageType === 'payment_help_1' ? 'payment_help' : 'abandoned_cart'},
        locale = ${rendered.locale},
        subject = ${rendered.subject},
        idempotency_key = ${idempotencyKey},
        discount_code = ${rendered.discountGrant?.code ?? null},
        discount_source = ${rendered.discountGrant?.source ?? null},
        discount_shopify_id = ${rendered.discountGrant?.shopifyDiscountId ?? null},
        snapshot_html_key = ${snapshot?.html_key ?? null},
        snapshot_html_url = ${snapshot?.html_url ?? null},
        snapshot_text_key = ${snapshot?.text_key ?? null},
        snapshot_text_url = ${snapshot?.text_url ?? null},
        snapshot_subject = ${snapshot?.subject ?? rendered.subject},
        snapshot_sha256 = ${snapshot?.sha256 ?? null},
        snapshot_saved_at = ${snapshot?.saved_at ?? null},
        snapshot_error = ${snapshot?.error ?? null},
        updated_at = NOW()
    WHERE id = ${messageId}`

  await sql`
    UPDATE carts
    SET abandon_notified_at = NOW(),
        abandon_notified_count = GREATEST(
          COALESCE(abandon_notified_count, 0),
          (
            SELECT COUNT(*)::int
            FROM abandoned_cart_messages
            WHERE cart_id = ${c.id}
              AND status = 'sent'
              AND message_type IN ('abandoned_cart_1', 'abandoned_cart_2', 'abandoned_cart_3', 'payment_help_1')
          )
        ),
        abandon_notified_source = 'manta',
        updated_at = NOW()
    WHERE id = ${c.id}`
}

async function findLocalOrderAfter(sql: RuntimeSql, email: string, since: Date): Promise<ShopifyOrderMatch | null> {
  const rows = await sql<
    Array<{
      shopify_order_id: string
      order_number: string | null
      placed_at: Date | string
      total_price: number | null
      currency: string | null
    }>
  >`
    SELECT shopify_order_id, order_number, placed_at, total_price, currency
    FROM orders
    WHERE LOWER(email) = LOWER(${email})
      AND placed_at >= ${since}
      AND status IN ('paid', 'fulfilled')
    ORDER BY placed_at DESC
    LIMIT 1`
  const row = rows[0]
  if (!row) return null
  return {
    id: row.shopify_order_id,
    name: row.order_number,
    createdAt: toDate(row.placed_at).toISOString(),
    total: row.total_price,
    currency: row.currency,
  }
}

async function findShopifyOrderAfter(
  email: string,
  since: Date,
  signal: AbortSignal | undefined,
): Promise<
  { status: 'found'; order: ShopifyOrderMatch } | { status: 'none' } | { status: 'unavailable'; error: string }
> {
  try {
    const token =
      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_ACCESS_TOKEN
    const domain = process.env.SHOPIFY_SHOP_DOMAIN ?? 'fancy-palas.myshopify.com'
    if (!token) return { status: 'unavailable', error: 'SHOPIFY_ADMIN_ACCESS_TOKEN missing' }
    const client = new ShopifyAdminClient({ token, domain })
    const escapedEmail = email.replace(/"/g, '\\"')
    const query = `email:"${escapedEmail}" created_at:>=${since.toISOString()}`
    const data = await client.query<{
      orders: {
        edges: Array<{
          node: {
            id: string
            name: string | null
            email: string | null
            createdAt: string
            totalPriceSet?: { shopMoney?: { amount?: string | null; currencyCode?: string | null } }
          }
        }>
      }
    }>(
      `query ($q: String!) {
        orders(first: 1, query: $q, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              email
              createdAt
              totalPriceSet { shopMoney { amount currencyCode } }
            }
          }
        }
      }`,
      { q: query },
      signal,
    )
    const node = data.orders?.edges?.[0]?.node
    if (!node) return { status: 'none' }
    return {
      status: 'found',
      order: {
        id: node.id,
        name: node.name,
        createdAt: node.createdAt,
        total: Number(node.totalPriceSet?.shopMoney?.amount ?? 0),
        currency: node.totalPriceSet?.shopMoney?.currencyCode ?? null,
      },
    }
  } catch (err) {
    return { status: 'unavailable', error: (err as Error).message }
  }
}

async function hasRecentKlaviyoAbandon(sql: RuntimeSql, email: string, since: Date): Promise<Date | null> {
  const rows = await sql<Array<{ occurred_at: Date | string }>>`
    SELECT occurred_at
    FROM klaviyo_events
    WHERE LOWER(email) = LOWER(${email})
      AND occurred_at >= ${since}
      AND (
        metric = ANY(${KLAVIYO_ABANDON_METRICS})
        OR (metric = 'Received Email' AND (
          subject ILIKE '%oublié quelque chose%'
          OR subject ILIKE '%pensez encore%'
          OR subject ILIKE '%attend plus que vous%'
        ))
      )
    ORDER BY occurred_at DESC
    LIMIT 1`
  return rows[0]?.occurred_at ? toDate(rows[0].occurred_at) : null
}

async function renderMessage(opts: {
  cart: CandidateRow
  messageType: MessageType
  adminBase: string
  discountGrant: DiscountGrant | null
}): Promise<RenderedMessage> {
  const items = coerceItems(opts.cart.items)
  const locale = pickLocale({
    browserLocale: opts.cart.browser_locale,
    contactLocale: opts.cart.contact_locale,
    countryCode: opts.cart.country_code,
  })
  const recoveryUrl = buildRecoveryUrl(
    {
      checkout_token: opts.cart.checkout_token,
      cart_token: opts.cart.cart_token,
      items: items.map((it) => ({ id: it.id, quantity: it.quantity })),
    },
    {
      discountCode: opts.discountGrant?.code ?? null,
    },
  )
  const unsubscribeToken = signUnsubscribeToken(opts.cart.email)
  const unsubscribeUrl = `${opts.adminBase}/api/contact/unsubscribe?t=${unsubscribeToken}`

  if (opts.messageType !== 'payment_help_1') {
    const rendered = await renderAbandonedCart({
      locale,
      firstName: opts.cart.first_name,
      items,
      currency: opts.cart.currency ?? 'EUR',
      recoveryUrl,
      unsubscribeUrl,
      discountCode: opts.discountGrant?.code ?? null,
    })
    return { ...rendered, locale, recoveryUrl, unsubscribeUrl, discountGrant: opts.discountGrant }
  }

  const greeting = opts.cart.first_name ? `Bonjour ${opts.cart.first_name},` : 'Bonjour,'
  const subject = locale === 'en' ? 'Need help finalising your order?' : 'Besoin d’aide pour finaliser votre commande ?'
  const text =
    locale === 'en'
      ? `${greeting}\n\nWe noticed your order was not finalised. If something blocked you on the site, reply directly to this email and we will help.\n\nYou can also return to your cart here: ${recoveryUrl}\n\nUnsubscribe: ${unsubscribeUrl}`
      : `${greeting}\n\nVotre commande n’a pas été finalisée. Si quelque chose vous a bloqué sur le site, répondez directement à cet email et on vous aidera.\n\nVous pouvez aussi retrouver votre panier ici : ${recoveryUrl}\n\nDésinscription : ${unsubscribeUrl}`
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#222">
      <p>${greeting}</p>
      <p>${
        locale === 'en'
          ? 'We noticed your order was not finalised. If something blocked you on the site, reply directly to this email and we will help.'
          : 'Votre commande n’a pas été finalisée. Si quelque chose vous a bloqué sur le site, répondez directement à cet email et on vous aidera.'
      }</p>
      <p><a href="${recoveryUrl}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;text-decoration:none;border-radius:4px">${
        locale === 'en' ? 'Return to my cart' : 'Retrouver mon panier'
      }</a></p>
      <p style="font-size:12px;color:#777"><a href="${unsubscribeUrl}">${
        locale === 'en' ? 'Unsubscribe' : 'Se désinscrire'
      }</a></p>
    </div>`
  return { subject, html, text, locale, recoveryUrl, unsubscribeUrl, discountGrant: opts.discountGrant }
}

export async function reconcileAbandonedCartRecoveries(
  sql: RuntimeSql,
  recoveryWindowDays = DEFAULT_RECOVERY_WINDOW_DAYS,
): Promise<number> {
  const rows = await sql<Array<{ recovered: string }>>`
    WITH recovered AS (
      SELECT DISTINCT ON (acc.id)
        acc.id AS case_id,
        m.id AS message_id,
        o.shopify_order_id,
        o.placed_at,
        o.total_price
      FROM abandoned_cart_cases acc
      JOIN abandoned_cart_messages m
        ON m.case_id = acc.id
       AND m.status = 'sent'
       AND m.sent_at IS NOT NULL
      JOIN orders o
        ON LOWER(o.email) = LOWER(acc.email)
       AND o.placed_at > m.sent_at
       AND o.placed_at <= m.sent_at + (${recoveryWindowDays}::text || ' days')::interval
       AND o.status IN ('paid', 'fulfilled')
      WHERE acc.status = 'open'
      ORDER BY acc.id, o.placed_at ASC, m.sent_at DESC
    ),
    updated AS (
      UPDATE abandoned_cart_cases acc
      SET status = 'recovered',
          recovered_at = recovered.placed_at,
          recovered_order_id = recovered.shopify_order_id,
          recovered_amount = recovered.total_price,
          recovered_source_message_id = recovered.message_id,
          updated_at = NOW()
      FROM recovered
      WHERE acc.id = recovered.case_id
      RETURNING acc.id
    )
    SELECT COUNT(*)::text AS recovered FROM updated`
  return Number(rows[0]?.recovered ?? 0)
}

export async function runAbandonedCartCampaign(
  opts: AbandonedCartCampaignOptions,
  signal?: AbortSignal,
): Promise<AbandonedCartCampaignResult> {
  const {
    sql,
    notification,
    file,
    adminBase,
    fromEmail,
    replyTo,
    batchLimit = 100,
    dryRun = false,
    checkKlaviyo = false,
    maxCaseAgeDays = DEFAULT_MAX_CASE_AGE_DAYS,
    recoveryWindowDays = DEFAULT_RECOVERY_WINDOW_DAYS,
    log,
  } = opts

  const now = new Date()
  const cutoff = new Date(now.getTime() - maxCaseAgeDays * DAY_MS)
  const candidates = await sql<CandidateRow[]>`
    SELECT
      c.id, c.cart_token, c.checkout_token, c.distinct_id, c.email,
      c.first_name, c.country_code, c.browser_locale, c.items, c.total_price, c.currency,
      c.last_action_at, c.highest_stage,
      ct.id AS contact_id,
      ct.locale AS contact_locale,
      COALESCE(ct.orders_count, 0)::int AS contact_orders_count,
      ct.email_marketing_opt_out_at,
      ct.klaviyo_suppressed
    FROM carts c
    LEFT JOIN contacts ct ON LOWER(ct.email) = LOWER(c.email)
    WHERE c.email IS NOT NULL
      AND c.items IS NOT NULL
      AND jsonb_array_length(c.items) > 0
      AND c.last_action_at >= ${cutoff}
      AND c.last_action_at <= ${new Date(now.getTime() - PAYMENT_HELP_AFTER_HOURS * HOUR_MS)}
      AND c.highest_stage <> 'completed'
      AND COALESCE(c.status, 'active') <> 'completed'
      AND COALESCE(c.shopify_order_id, '') = ''
    ORDER BY c.last_action_at ASC
    LIMIT ${batchLimit * 5}`

  const result: AbandonedCartCampaignResult = {
    scanned: candidates.length,
    due: 0,
    sent: 0,
    skipped: 0,
    skipped_optout: 0,
    skipped_no_products: 0,
    skipped_shopify_order: 0,
    skipped_shopify_unavailable: 0,
    skipped_klaviyo: 0,
    recovered: 0,
    errors: 0,
  }

  for (const c of candidates) {
    if (signal?.aborted || result.due >= batchLimit) break

    const cartCase = await ensureCase(sql, c)
    if (cartCase.status !== 'open') continue
    const messages = await loadMessages(sql, cartCase.id)
    const next = nextMessage(c, messages, now)
    if (!next) continue

    result.due += 1
    const items = coerceItems(c.items)
    if (items.length === 0) {
      if (!dryRun) {
        const msg = await createPendingMessage(sql, c, cartCase.id, next.type, next.scheduledFor)
        await markSkipped(sql, cartCase.id, msg.id, 'no_products')
      }
      result.skipped++
      result.skipped_no_products++
      continue
    }

    const message = dryRun ? null : await createPendingMessage(sql, c, cartCase.id, next.type, next.scheduledFor)
    const messageId = message?.id ?? null

    if (c.email_marketing_opt_out_at || c.klaviyo_suppressed === true) {
      if (!dryRun && messageId) {
        await logCheck(sql, cartCase.id, messageId, 'opt_out', 'blocked', 'contact opted out or suppressed')
        await markSkipped(sql, cartCase.id, messageId, 'opt_out')
      }
      result.skipped++
      result.skipped_optout++
      continue
    }
    if (!dryRun && messageId) await logCheck(sql, cartCase.id, messageId, 'opt_out', 'passed')

    const since = toDate(c.last_action_at)
    const localOrder = await findLocalOrderAfter(sql, c.email, since)
    const shopifyOrder = localOrder
      ? { status: 'found' as const, order: localOrder }
      : await findShopifyOrderAfter(c.email, since, signal)

    if (shopifyOrder.status === 'found') {
      if (!dryRun && messageId) {
        await logCheck(
          sql,
          cartCase.id,
          messageId,
          'shopify_order',
          'blocked',
          `${shopifyOrder.order.name ?? shopifyOrder.order.id} at ${shopifyOrder.order.createdAt}`,
        )
        await markSkipped(sql, cartCase.id, messageId, 'shopify_order_found')
      }
      result.skipped++
      result.skipped_shopify_order++
      continue
    }
    if (shopifyOrder.status === 'unavailable') {
      if (!dryRun && messageId) {
        await logCheck(sql, cartCase.id, messageId, 'shopify_order', 'error', shopifyOrder.error)
        await markSkipped(sql, cartCase.id, messageId, 'shopify_check_unavailable', shopifyOrder.error)
      }
      result.skipped++
      result.skipped_shopify_unavailable++
      continue
    }
    if (!dryRun && messageId) await logCheck(sql, cartCase.id, messageId, 'shopify_order', 'passed')

    if (checkKlaviyo) {
      const klaviyoAt = await hasRecentKlaviyoAbandon(sql, c.email, since)
      if (klaviyoAt) {
        if (!dryRun && messageId) {
          await logCheck(sql, cartCase.id, messageId, 'klaviyo_email', 'blocked', klaviyoAt.toISOString())
          await markSkipped(sql, cartCase.id, messageId, 'klaviyo_email_found')
        }
        result.skipped++
        result.skipped_klaviyo++
        continue
      }
      if (!dryRun && messageId) await logCheck(sql, cartCase.id, messageId, 'klaviyo_email', 'passed')
    }

    const discountGrant =
      dryRun || next.type === 'payment_help_1'
        ? null
        : await resolveWelcomeDiscountForEmail({
            email: c.email,
            numberOfOrders: c.contact_orders_count ?? 0,
            log,
            signal,
          })
    const rendered = await renderMessage({ cart: c, messageType: next.type, adminBase, discountGrant })
    if (dryRun) {
      log.info(`[abandoned-cart-campaign] dry cart=${c.id} email=${c.email} type=${next.type}`)
      result.skipped++
      continue
    }

    // Persist the navigation language back onto the contact fiche, so the
    // contact's locale reflects their last browse. Only when we actually have
    // a navigation signal (`browser_locale`) — never overwrite from a
    // country/default-derived guess, which would clobber a real signal.
    if (c.contact_id && c.browser_locale) {
      await sql`
        UPDATE contacts
        SET locale = ${rendered.locale}, updated_at = NOW()
        WHERE id = ${c.contact_id}
          AND lower(split_part(COALESCE(locale, ''), '-', 1)) IS DISTINCT FROM ${rendered.locale}`
    }

    if (!messageId) {
      result.errors++
      continue
    }

    const idempotencyKey = `abandoned-cart:${next.type}:${c.id}`
    const snapshot = await archiveEmailSnapshot(file, {
      messageId,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })
    if (snapshot.error) {
      log.warn(`[abandoned-cart-campaign] snapshot failed message=${messageId}: ${snapshot.error}`)
    }

    try {
      const sendResult = await notification.send({
        to: c.email,
        channel: 'email',
        from: fromEmail,
        replyTo,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: {
          'List-Unsubscribe': `<${rendered.unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        tags: [
          { name: 'category', value: next.type === 'payment_help_1' ? 'payment-help' : 'abandoned-cart' },
          { name: 'cart_id', value: c.id },
          { name: 'message_type', value: next.type },
          { name: 'locale', value: rendered.locale },
          ...(rendered.discountGrant ? [{ name: 'discount_source', value: rendered.discountGrant.source }] : []),
        ],
        idempotency_key: idempotencyKey,
      })

      if (sendResult.status !== 'SUCCESS') {
        await markSkipped(sql, cartCase.id, messageId, 'send_error', sendResult.error?.message ?? sendResult.status)
        result.errors++
        continue
      }

      await markSent(sql, c, messageId, next.type, rendered, sendResult.id, idempotencyKey, snapshot)
      result.sent++
      log.info(`[abandoned-cart-campaign] sent cart=${c.id} email=${c.email} type=${next.type}`)

      try {
        await sendPosthogEvent({
          event: 'manta_abandoned_cart_message_sent',
          distinctId: c.distinct_id ?? c.email.toLowerCase(),
          email: c.email,
          properties: {
            cart_id: c.id,
            cart_token: c.cart_token,
            message_type: next.type,
            locale: rendered.locale,
            total_price: c.total_price ?? 0,
            currency: c.currency ?? 'EUR',
            discount_code: rendered.discountGrant?.code ?? null,
            discount_source: rendered.discountGrant?.source ?? null,
            sent_at: new Date().toISOString(),
          },
        })
      } catch (err) {
        log.warn(`[abandoned-cart-campaign] posthog capture failed cart=${c.id}: ${(err as Error).message}`)
      }
    } catch (err) {
      await markSkipped(sql, cartCase.id, messageId, 'send_error', (err as Error).message)
      result.errors++
      log.error(`[abandoned-cart-campaign] send threw cart=${c.id}: ${(err as Error).message}`)
    }
  }

  result.recovered = await reconcileAbandonedCartRecoveries(sql, recoveryWindowDays)
  return result
}
