// Resolve a Klaviyo $exchange_id to a profile identity.
//
// Uses the profile-import endpoint with `_kx` (the same technique as the
// plugin-posthog-proxy identity bridge). That endpoint accepts an exchange id
// and returns the matching profile — with the email attribute populated only
// if the profile has been identified client-side (newsletter submit, form…).
//
// Never throws. Returns { email, identified } on success, null on API failure.
// `identified = false` means the exchange_id is valid but the profile is still
// anonymous in Klaviyo (no email captured yet).

export interface KlaviyoProfile {
  email: string | null
  identified: boolean
}

export async function resolveKlaviyoProfile(exchangeId: string): Promise<KlaviyoProfile | null> {
  const key = process.env.KLAVIYO_API_KEY
  if (!key) return null

  const host = process.env.KLAVIYO_HOST ?? 'https://a.klaviyo.com'
  const MAX_RETRIES = 3

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${host}/api/profile-import/`, {
        method: 'POST',
        headers: {
          Authorization: `Klaviyo-API-Key ${key}`,
          'Content-Type': 'application/json',
          accept: 'application/json',
          revision: '2024-10-15',
        },
        body: JSON.stringify({
          data: {
            type: 'profile',
            attributes: { _kx: exchangeId },
          },
        }),
      })

      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 200 * attempt))
            continue
          }
        }
        return null
      }

      const data = (await res.json()) as { data?: { attributes?: { email?: string | null } } }
      const email = data.data?.attributes?.email ?? null
      return { email, identified: typeof email === 'string' && email.length > 0 }
    } catch {
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 200 * attempt))
        continue
      }
      return null
    }
  }
  return null
}
