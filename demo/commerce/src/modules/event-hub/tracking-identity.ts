import { createHash } from 'node:crypto'

// Separate destination formatting from the CRM's email identity contract.
export function googleEmailSha256(email: string | null): string | null {
  if (!email) return null
  const normalized = email.trim().toLowerCase()
  const parts = normalized.split('@')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  if (parts[1] === 'gmail.com' || parts[1] === 'googlemail.com') {
    parts[0] = parts[0].split('+')[0].replaceAll('.', '')
  }
  return createHash('sha256').update(parts.join('@')).digest('hex')
}

export function numericSessionId(value: unknown): string | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''
  return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) > 0 ? text : null
}

// PostHog sessions are UUIDv7. Reuse their start time, never the time of each event.
// This identifies a server-only session; it does not claim to match a Google tag session.
export function posthogSessionAsNumeric(value: string | null): string | null {
  const numeric = numericSessionId(value)
  if (numeric) return numeric
  if (!value || !/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) return null
  return numericSessionId(Math.floor(Number.parseInt(value.replaceAll('-', '').slice(0, 12), 16) / 1000))
}

// Keep the browser bridge when a contact is resolved, while retaining the legacy
// customer identifier for already matched audiences. Never send raw identifiers.
export function externalIdentityHashes(user: Record<string, unknown>, legacy: string | null): string[] {
  const visitor = typeof user.visitor_id === 'string' ? user.visitor_id.trim() : ''
  return [
    ...new Set(
      [legacy, visitor ? createHash('sha256').update(visitor).digest('hex') : null].filter((v): v is string =>
        Boolean(v),
      ),
    ),
  ]
}
