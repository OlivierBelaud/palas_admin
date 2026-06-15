import { renderAbandonedCart } from '../../emails/abandoned-cart/render'
import type { Locale } from '../../emails/abandoned-cart/strings'
import { readRows } from '../../utils/drizzle-read'
import { type RuntimeApp, type RuntimeFilePort, resolveFile } from '../../utils/manta-runtime'
import { resolveRawDb } from '../../utils/raw-db'
import { buildRecoveryUrl } from '../../utils/recovery-url'
import { signUnsubscribeToken } from '../../utils/unsubscribe-token'

type MessageRow = {
  id: string
  case_id: string
  cart_id: string
  email: string
  message_type: string
  sequence_version: number
  sequence_started_at: string | Date | null
  status: string
  scheduled_for: string | Date
  sent_at: string | Date | null
  provider: string | null
  provider_message_id: string | null
  template_key: string | null
  locale: string | null
  subject: string | null
  skip_reason: string | null
  error_message: string | null
  discount_code: string | null
  discount_source: string | null
  snapshot_html_key: string | null
  snapshot_html_url: string | null
  snapshot_text_key: string | null
  snapshot_text_url: string | null
  snapshot_subject: string | null
  snapshot_sha256: string | null
  snapshot_saved_at: string | Date | null
  snapshot_error: string | null
  created_at: string | Date | null
  updated_at: string | Date | null
}

type CartRow = {
  id: string
  cart_token: string | null
  checkout_token: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  items: unknown
  total_price: number | null
  item_count: number | null
  currency: string | null
  status: string | null
  highest_stage: string | null
  last_action: string | null
  last_action_at: string | Date | null
  completed_at: string | Date | null
  country_code: string | null
}

type ContactRow = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  live_orders_count?: number
  live_total_spent?: number
}

type OrderRow = {
  id: string
  order_number: string | null
  total_price: number
  currency: string | null
  status: string
  placed_at: string | Date | null
}

const GWP_TITLE_RX = /\b(?:gift|offert|free|charm offert)\b/i
const SNAPSHOT_PREVIEW_TIMEOUT_MS = 700

export default defineQuery({
  name: 'email-detail',
  description: 'Sent abandoned-cart email detail with reconstructed preview and customer context.',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, ctx) => {
    const { db, schema } = ctx as { db: unknown; schema: Record<string, unknown> }
    const rawDb = resolveRawDb(ctx)
    const file = resolveFile((ctx as { app?: RuntimeApp }).app)
    const messages = (await readRows(
      { db, schema },
      {
        entity: 'abandonedCartMessage',
        filters: { id: input.id },
        fields: [
          'id',
          'case_id',
          'cart_id',
          'email',
          'message_type',
          'sequence_version',
          'sequence_started_at',
          'status',
          'scheduled_for',
          'sent_at',
          'provider',
          'provider_message_id',
          'template_key',
          'locale',
          'subject',
          'skip_reason',
          'error_message',
          'discount_code',
          'discount_source',
          'snapshot_html_key',
          'snapshot_html_url',
          'snapshot_text_key',
          'snapshot_text_url',
          'snapshot_subject',
          'snapshot_sha256',
          'snapshot_saved_at',
          'snapshot_error',
          'created_at',
          'updated_at',
        ],
        pagination: { limit: 1 },
      },
    )) as MessageRow[]

    const message = messages[0]
    if (!message) throw new MantaError('NOT_FOUND', `Email ${input.id} not found`)

    const [carts, contacts, orders, orderAggRows] = await Promise.all([
      readRows(
        { db, schema },
        {
          entity: 'cart',
          filters: { id: message.cart_id },
          fields: [
            'id',
            'cart_token',
            'checkout_token',
            'email',
            'first_name',
            'last_name',
            'items',
            'total_price',
            'item_count',
            'currency',
            'status',
            'highest_stage',
            'last_action',
            'last_action_at',
            'completed_at',
            'country_code',
          ],
          pagination: { limit: 1 },
        },
      ) as Promise<CartRow[]>,
      readRows(
        { db, schema },
        {
          entity: 'contact',
          filters: { email: message.email },
          fields: ['id', 'email', 'first_name', 'last_name'],
          pagination: { limit: 1 },
        },
      ) as Promise<ContactRow[]>,
      readRows(
        { db, schema },
        {
          entity: 'order',
          filters: { email: message.email },
          fields: ['id', 'order_number', 'total_price', 'currency', 'status', 'placed_at'],
          sort: { placed_at: 'desc' },
          pagination: { limit: 5 },
        },
      ) as Promise<OrderRow[]>,
      rawDb.raw<{ live_orders_count: number | string; live_total_spent: number | string | null }>(
        `SELECT COUNT(*)::int AS live_orders_count,
                COALESCE(SUM(total_price), 0)::float AS live_total_spent
           FROM orders
          WHERE LOWER(email) = LOWER($1)
            AND status IN ('paid', 'fulfilled')
            AND deleted_at IS NULL`,
        [message.email],
      ),
    ])

    const cart = carts[0] ?? null
    const orderAgg = orderAggRows[0] as
      | { live_orders_count?: number | string; live_total_spent?: number | string | null }
      | undefined
    const contact = contacts[0]
      ? {
          ...contacts[0],
          live_orders_count: Number(orderAgg?.live_orders_count ?? 0),
          live_total_spent: Number(orderAgg?.live_total_spent ?? 0),
        }
      : null
    const preview = await resolvePreview(message, cart, file)

    return {
      message: {
        ...serializeDates(message),
        preview_note:
          preview.source === 'snapshot'
            ? 'Snapshot exact archive au moment de l envoi client.'
            : 'Apercu reconstruit depuis le panier et le template actuels, car aucun snapshot exact n est disponible pour cet email.',
      },
      preview,
      cart: cart ? serializeDates(cart) : null,
      contact,
      orders: orders.map(serializeDates),
    }
  },
})

async function resolvePreview(message: MessageRow, cart: CartRow | null, file: RuntimeFilePort | null) {
  const snapshot = await loadSnapshotPreview(message, file)
  if (snapshot) return snapshot
  return renderPreview(message, cart)
}

async function loadSnapshotPreview(message: MessageRow, file: RuntimeFilePort | null) {
  const fileSnapshot = await loadSnapshotFromFilePort(message, file)
  if (fileSnapshot) return fileSnapshot

  if (!message.snapshot_html_url) return null
  try {
    const [html, text] = await Promise.all([
      fetchTextSnapshot(message.snapshot_html_url),
      message.snapshot_text_url ? fetchTextSnapshot(message.snapshot_text_url) : Promise.resolve(null),
    ])
    if (!html) return null
    return {
      html,
      text,
      subject: message.snapshot_subject ?? message.subject,
      source: 'snapshot' as const,
      snapshot_saved_at: serializeDate(message.snapshot_saved_at),
      snapshot_sha256: message.snapshot_sha256,
      snapshot_error: message.snapshot_error,
    }
  } catch {
    return null
  }
}

async function loadSnapshotFromFilePort(message: MessageRow, file: RuntimeFilePort | null) {
  if (!file || !message.snapshot_html_key) return null
  try {
    const [htmlBuffer, textBuffer] = await Promise.all([
      withTimeout(file.getAsBuffer(message.snapshot_html_key), SNAPSHOT_PREVIEW_TIMEOUT_MS),
      message.snapshot_text_key
        ? withTimeout(file.getAsBuffer(message.snapshot_text_key), SNAPSHOT_PREVIEW_TIMEOUT_MS).catch(() => null)
        : Promise.resolve(null),
    ])
    return {
      html: htmlBuffer.toString('utf8'),
      text: textBuffer?.toString('utf8') ?? null,
      subject: message.snapshot_subject ?? message.subject,
      source: 'snapshot' as const,
      snapshot_saved_at: serializeDate(message.snapshot_saved_at),
      snapshot_sha256: message.snapshot_sha256,
      snapshot_error: message.snapshot_error,
    }
  } catch {
    return null
  }
}

async function fetchTextSnapshot(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SNAPSHOT_PREVIEW_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    return res.ok ? await res.text() : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Snapshot preview timeout')), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function renderPreview(message: MessageRow, cart: CartRow | null) {
  const fallback = {
    html: null,
    text: null,
    subject: message.subject,
    source: 'reconstructed' as const,
    snapshot_saved_at: null,
    snapshot_sha256: message.snapshot_sha256,
    snapshot_error: message.snapshot_error,
  }
  if (!cart || !message.email) return fallback
  const items = coerceItems(cart.items)
  if (items.length === 0) return fallback

  const recoveryUrl = buildRecoveryUrl(
    {
      checkout_token: cart.checkout_token,
      cart_token: cart.cart_token,
      items: items.map((item) => ({ id: item.id, quantity: item.quantity })),
    },
    { discountCode: message.discount_code },
  )
  const adminBase = (process.env.ADMIN_BASE_URL ?? 'https://admin.fancypalas.com').replace(/\/+$/, '')
  const unsubscribeUrl = `${adminBase}/api/contact/unsubscribe?t=${signUnsubscribeToken(message.email)}`
  const locale = normalizeLocale(message.locale)

  const rendered = await renderAbandonedCart({
    locale,
    firstName: cart.first_name,
    items,
    currency: cart.currency ?? 'EUR',
    recoveryUrl,
    unsubscribeUrl,
    discountCode: message.discount_code,
  })

  return {
    html: rendered.html,
    text: rendered.text,
    subject: message.subject ?? rendered.subject,
    source: 'reconstructed' as const,
    snapshot_saved_at: serializeDate(message.snapshot_saved_at),
    snapshot_sha256: message.snapshot_sha256,
    snapshot_error: message.snapshot_error,
  }
}

function normalizeLocale(value: string | null): Locale {
  return value === 'en' ? 'en' : 'fr'
}

function coerceItems(raw: unknown) {
  if (!Array.isArray(raw)) return []
  const out: Array<{
    id: string | number | null
    title: string
    quantity: number
    line_price?: number | null
    image_url?: string | null
  }> = []
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue
    const row = value as Record<string, unknown>
    const title = typeof row.title === 'string' ? row.title : ''
    if (!title || GWP_TITLE_RX.test(title)) continue
    const id = typeof row.id === 'string' || typeof row.id === 'number' ? row.id : null
    const quantity = typeof row.quantity === 'number' && Number.isFinite(row.quantity) ? row.quantity : 1
    const linePrice =
      typeof row.line_price === 'number' && row.line_price > 0
        ? row.line_price
        : typeof row.price === 'number' && row.price > 0
          ? row.price
          : null
    out.push({
      id,
      title,
      quantity,
      line_price: linePrice,
      image_url: typeof row.image_url === 'string' ? row.image_url : null,
    })
  }
  return out
}

function serializeDates<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row }
  for (const [key, value] of Object.entries(out)) {
    if (value instanceof Date) out[key as keyof T] = value.toISOString() as T[keyof T]
  }
  return out
}

function serializeDate(value: string | Date | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}
