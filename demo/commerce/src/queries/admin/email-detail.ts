import { renderAbandonedCart } from '../../emails/abandoned-cart/render'
import type { Locale } from '../../emails/abandoned-cart/strings'
import { type RuntimeApp, type RuntimeFilePort, resolveFile } from '../../utils/manta-runtime'
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
  orders_count: number
  total_spent: number
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

export default defineQuery({
  name: 'email-detail',
  description: 'Sent abandoned-cart email detail with reconstructed preview and customer context.',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, ctx) => {
    const { query } = ctx
    const file = resolveFile((ctx as { app?: RuntimeApp }).app)
    const messages = (await query.graph({
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
    })) as MessageRow[]

    const message = messages[0]
    if (!message) throw new MantaError('NOT_FOUND', `Email ${input.id} not found`)

    const [carts, contacts, orders] = await Promise.all([
      query.graph({
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
      }) as Promise<CartRow[]>,
      query.graph({
        entity: 'contact',
        filters: { email: message.email },
        fields: ['id', 'email', 'first_name', 'last_name', 'orders_count', 'total_spent'],
        pagination: { limit: 1 },
      }) as Promise<ContactRow[]>,
      query.graph({
        entity: 'order',
        filters: { email: message.email },
        fields: ['id', 'order_number', 'total_price', 'currency', 'status', 'placed_at'],
        sort: { placed_at: 'desc' },
        pagination: { limit: 5 },
      }) as Promise<OrderRow[]>,
    ])

    const cart = carts[0] ?? null
    const contact = contacts[0] ?? null
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
    const htmlRes = await fetchWithTimeout(message.snapshot_html_url)
    if (!htmlRes.ok) return null
    const [html, text] = await Promise.all([
      htmlRes.text(),
      message.snapshot_text_url
        ? fetchWithTimeout(message.snapshot_text_url).then((res) => (res.ok ? res.text() : null))
        : Promise.resolve(null),
    ])
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
      file.getAsBuffer(message.snapshot_html_key),
      message.snapshot_text_key ? file.getAsBuffer(message.snapshot_text_key).catch(() => null) : Promise.resolve(null),
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

async function fetchWithTimeout(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2500)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
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
