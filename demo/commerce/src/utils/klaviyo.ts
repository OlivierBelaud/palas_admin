// Tiny Klaviyo client — two use cases.
//
//   1. sendKlaviyoEvent  — POST /api/events/. One event per call. The profile
//      is associated by email; Klaviyo handles lookup/creation server-side.
//   2. subscribeKlaviyoProfile — POST /api/profile-subscription-bulk-create-jobs/.
//      Opts a profile into marketing email on a given list with consent.
//
// Both use the Events API v2024-10-15 and never throw — they return
// { ok, status?, error? } so the caller can decide whether to mark the source
// record as "sent" (only on ok=true).

export interface KlaviyoEventInput {
  email: string
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
  metric: string
  properties: Record<string, unknown>
  time?: Date
  value?: number
  value_currency?: string
  /** Stable dedupe key — lets Klaviyo ignore re-sends of the same event. */
  unique_id?: string
}

export interface KlaviyoResult {
  ok: boolean
  status?: number
  error?: string
}

export async function sendKlaviyoEvent(event: KlaviyoEventInput): Promise<KlaviyoResult> {
  const key = process.env.KLAVIYO_API_KEY
  if (!key) return { ok: false, error: 'KLAVIYO_API_KEY missing' }

  const host = process.env.KLAVIYO_HOST ?? 'https://a.klaviyo.com'

  const profileAttributes: Record<string, unknown> = { email: event.email }
  if (event.first_name) profileAttributes.first_name = event.first_name
  if (event.last_name) profileAttributes.last_name = event.last_name
  if (event.phone) profileAttributes.phone_number = event.phone

  const attributes: Record<string, unknown> = {
    properties: event.properties,
    metric: { data: { type: 'metric', attributes: { name: event.metric } } },
    profile: { data: { type: 'profile', attributes: profileAttributes } },
    time: (event.time ?? new Date()).toISOString(),
  }
  if (event.value !== undefined) attributes.value = event.value
  if (event.value_currency) attributes.value_currency = event.value_currency
  if (event.unique_id) attributes.unique_id = event.unique_id

  try {
    const res = await fetch(`${host}/api/events/`, {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${key}`,
        revision: '2024-10-15',
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ data: { type: 'event', attributes } }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, status: res.status, error: body.slice(0, 300) }
    }
    return { ok: true, status: res.status }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export interface KlaviyoSubscribeInput {
  email: string
  listId: string
  /** Free-form source tag stored on the subscription (e.g. "cart_drawer_surprise"). */
  customSource?: string
}

/**
 * Opts a profile into marketing email on a Klaviyo list.
 * Uses the bulk subscription job API (the single-profile subscribe endpoint
 * requires a company_id which the private API key doesn't expose).
 *
 * Consent = SUBSCRIBED ⇒ single opt-in. For double opt-in, configure the list
 * itself in Klaviyo → no code change needed (Klaviyo will send the confirm).
 */
export async function subscribeKlaviyoProfile(input: KlaviyoSubscribeInput): Promise<KlaviyoResult> {
  const key = process.env.KLAVIYO_API_KEY
  if (!key) return { ok: false, error: 'KLAVIYO_API_KEY missing' }

  const host = process.env.KLAVIYO_HOST ?? 'https://a.klaviyo.com'

  const body: Record<string, unknown> = {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: {
          data: [
            {
              type: 'profile',
              attributes: {
                email: input.email,
                subscriptions: {
                  email: {
                    marketing: { consent: 'SUBSCRIBED' },
                  },
                },
              },
            },
          ],
        },
        ...(input.customSource ? { custom_source: input.customSource } : {}),
      },
      relationships: {
        list: {
          data: { type: 'list', id: input.listId },
        },
      },
    },
  }

  try {
    const res = await fetch(`${host}/api/profile-subscription-bulk-create-jobs/`, {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${key}`,
        revision: '2024-10-15',
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, error: text.slice(0, 300) }
    }
    return { ok: true, status: res.status }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
