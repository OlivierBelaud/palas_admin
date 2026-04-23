// Tiny PostHog ingest helper — send one event to /i/v0/e/.
//
// Supports both "track" (event with properties) and the implicit $identify
// flow: when properties include `$set.email`, PostHog aliases the distinct_id
// to that email on the next pass. Also fires an explicit $identify event when
// an email is present to force the alias immediately.
//
// Uses the public POSTHOG_TOKEN (not the private API key) — these events are
// indistinguishable from regular client-side events once ingested.

export interface PosthogIngestInput {
  event: string
  distinctId: string
  properties?: Record<string, unknown>
  /** If set, fire $identify too so the anonymous profile is merged immediately. */
  email?: string
  /** If set, inherit $ip from the originating user instead of the serverless function. */
  ip?: string | null
}

export interface PosthogIngestResult {
  ok: boolean
  status?: number
  error?: string
}

export async function sendPosthogEvent(input: PosthogIngestInput): Promise<PosthogIngestResult> {
  const token = process.env.POSTHOG_TOKEN
  if (!token) return { ok: false, error: 'POSTHOG_TOKEN missing' }

  const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'

  const props: Record<string, unknown> = { ...(input.properties ?? {}) }
  if (input.email) {
    props.$set = { ...((props.$set as Record<string, unknown> | undefined) ?? {}), email: input.email }
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (input.ip) headers['x-forwarded-for'] = input.ip

    // Send both the actual event and a $identify, batched, so anonymous
    // distinct_id + email end up on the same PostHog person.
    const batch: Array<Record<string, unknown>> = [
      {
        event: input.event,
        distinct_id: input.distinctId,
        properties: props,
      },
    ]
    if (input.email) {
      batch.push({
        event: '$identify',
        distinct_id: input.distinctId,
        properties: { $set: { email: input.email } },
      })
    }

    const res = await fetch(`${host}/batch/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ api_key: token, batch }),
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
