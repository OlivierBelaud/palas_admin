export interface KlaviyoAbandonEventRow {
  klaviyo_event_id: string
  email: string
  metric: string
  subject: string | null
  checkout_token: string | null
  occurred_at: Date
  synced_at: Date
}

interface KlaviyoListResponse<T> {
  data?: T[]
  included?: Array<{ id: string; type: string; attributes?: Record<string, unknown> }>
  links?: { next?: string | null }
}

const ABANDON_METRICS = new Set([
  'Shopify_Checkout_Abandonned',
  'Checkout Abandoned',
  'Ops Cart Abandoned',
  'Received Email',
])

const ABANDON_SUBJECT =
  /oubli|attend plus que vous|commande palas vous attend|valider votre commande|sélection de bijoux palas vous attend|vos bijoux favoris vous attendent|your favourite jewellery is waiting for you|make it yours today|got a question or not quite sure|un doute.+question/i

export function isKlaviyoCartOrCheckoutEmail(event: {
  metric: string
  subject: string | null
}): boolean {
  return event.metric === 'Received Email' && ABANDON_SUBJECT.test(event.subject ?? '')
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function checkoutToken(properties: Record<string, unknown>): string | null {
  const direct = stringValue(properties.checkout_token)
  if (direct) return direct
  const url = stringValue(properties.checkout_url)
  return url?.match(/checkouts\/ac\/([^/?"]+)/)?.[1] ?? null
}

async function fetchJson<T>(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
  attempt = 0,
): Promise<T> {
  const response = await fetch(url, { headers, signal })
  if (response.status === 429 && attempt < 6) {
    const retryAfter = Number(response.headers.get('retry-after') ?? '1')
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, retryAfter) * 1000))
    return fetchJson<T>(url, headers, signal, attempt + 1)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new MantaError('UNEXPECTED_STATE', `Klaviyo events API ${response.status}: ${body.slice(0, 300)}`)
  }
  return (await response.json()) as T
}

export async function pullAbandonEventsFromKlaviyo(args: {
  apiKey: string
  sinceIso: string
  untilIso?: string
  host?: string
  revision?: string
  signal?: AbortSignal
  now?: () => Date
}): Promise<KlaviyoAbandonEventRow[]> {
  const host = (args.host ?? 'https://a.klaviyo.com').replace(/\/+$/, '')
  const headers = {
    Authorization: `Klaviyo-API-Key ${args.apiKey}`,
    revision: args.revision ?? '2025-04-15',
    accept: 'application/json',
  }

  const metrics = new Map<string, string>()
  let next: string | null = `${host}/api/metrics/`
  while (next) {
    const page: KlaviyoListResponse<{ id: string; attributes?: { name?: string } }> = await fetchJson(
      next,
      headers,
      args.signal,
    )
    for (const metric of page.data ?? []) {
      const name = stringValue(metric.attributes?.name)
      if (name && ABANDON_METRICS.has(name)) metrics.set(metric.id, name)
    }
    next = page.links?.next ?? null
  }

  if (metrics.size === 0) throw new MantaError('UNEXPECTED_STATE', 'Klaviyo events API returned no abandonment metrics')

  const out: KlaviyoAbandonEventRow[] = []
  const seen = new Set<string>()
  for (const [metricId, metricName] of metrics) {
    const timeFilters = [`greater-or-equal(datetime,${args.sinceIso})`]
    if (args.untilIso) timeFilters.push(`less-than(datetime,${args.untilIso})`)
    const filter = encodeURIComponent(`and(equals(metric_id,"${metricId}"),${timeFilters.join(',')})`)
    next = `${host}/api/events/?filter=${filter}&include=profile&sort=datetime&page[size]=100`
    while (next) {
      const page: KlaviyoListResponse<{
        id: string
        attributes?: { datetime?: string; event_properties?: Record<string, unknown> }
        relationships?: { profile?: { data?: { id?: string } | null } }
      }> = await fetchJson(next, headers, args.signal)
      const emails = new Map(
        (page.included ?? [])
          .filter((profile) => profile.type === 'profile')
          .map((profile) => [profile.id, stringValue(profile.attributes?.email)]),
      )
      for (const event of page.data ?? []) {
        if (!event.id || seen.has(event.id)) continue
        const properties = event.attributes?.event_properties ?? {}
        const subject = stringValue(properties.Subject)
        if (metricName === 'Received Email' && !isKlaviyoCartOrCheckoutEmail({ metric: metricName, subject })) continue
        const email = emails.get(event.relationships?.profile?.data?.id ?? '')
        const occurredAt = new Date(event.attributes?.datetime ?? '')
        if (!email || Number.isNaN(occurredAt.getTime())) continue
        seen.add(event.id)
        out.push({
          klaviyo_event_id: event.id,
          email: email.toLowerCase(),
          metric: metricName,
          subject,
          checkout_token: checkoutToken(properties),
          occurred_at: occurredAt,
          synced_at: args.now?.() ?? new Date(),
        })
      }
      next = page.links?.next ?? null
    }
  }

  return out.sort((a, b) => a.occurred_at.getTime() - b.occurred_at.getTime())
}
