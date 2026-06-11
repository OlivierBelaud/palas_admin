// Timeline events d'un cart — source PostHog (HogQL).
// PostHog garde tous les events ; on supprime la table locale cart_events
// pour ne pas stocker deux fois la même chose.

import { formatMoney } from '../../utils/currency'
import { posthogPrivateKey, runPosthogHogQL } from '../../utils/posthog-query'

export default defineQuery({
  name: 'cart-events-list',
  description: 'Get all events for a cart (PostHog source of truth), most recent first',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { query }) => {
    const [cart] = (await query.graph({
      entity: 'cart',
      filters: { id: input.id },
      fields: ['id', 'cart_token', 'distinct_id', 'currency'],
      pagination: { limit: 1 },
    })) as unknown as Array<{
      id: string
      cart_token: string | null
      distinct_id: string | null
      currency: string | null
    }>

    if (!cart) return []

    const key = posthogPrivateKey()
    if (!key) {
      throw new MantaError('INVALID_STATE', 'POSTHOG_PERSONAL_API_KEY required for cart timeline')
    }

    // Le cart_token peut contenir un suffixe `?key=...` — on garde la base pour matcher PostHog.
    const baseToken = (cart.cart_token ?? '').split('?')[0]
    const distinctId = cart.distinct_id ?? ''
    const tokenClause = baseToken
      ? `properties.cart.token LIKE '${baseToken}%' OR properties.checkout.token = '${baseToken}'`
      : ''
    const distinctClause = distinctId ? `distinct_id = '${distinctId}'` : ''
    const whereParts = [tokenClause, distinctClause].filter(Boolean)
    if (whereParts.length === 0) return []

    const hogql = `SELECT event, timestamp, properties
                     FROM events
                    WHERE (${whereParts.join(') OR (')})
                      AND (event LIKE 'cart:%' OR event LIKE 'checkout:%')
                    ORDER BY timestamp DESC
                    LIMIT 200`

    const rows = (await runPosthogHogQL(hogql, { privateKey: key })) as Array<
      [string, string, Record<string, unknown> | string]
    >

    const currency = cart.currency ?? 'EUR'
    return rows.map((row) => {
      const [event, timestamp, propsRaw] = row
      const props = typeof propsRaw === 'string' ? (JSON.parse(propsRaw) as Record<string, unknown>) : (propsRaw ?? {})
      const cartProps = (props.cart as { total_price?: number; item_count?: number } | undefined) ?? {}
      const checkoutProps = (props.checkout as { total_price?: number } | undefined) ?? {}
      const cleanAction = event
        .replace(/_info_submitted$/, '')
        .replace(/_submitted$/, '')
        .replace(/_info$/, '')
      const totalPrice = cartProps.total_price ?? checkoutProps.total_price ?? 0
      return {
        action: cleanAction,
        total_price: totalPrice,
        item_count: cartProps.item_count ?? 0,
        occurred_at: timestamp,
        cart_id: cart.id,
        currency,
        montant: formatMoney(totalPrice, currency),
      }
    })
  },
})
