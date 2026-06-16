export interface KlaviyoProfileApiResource {
  id: string
  attributes?: Record<string, unknown>
}

export interface KlaviyoContactSnapshot {
  klaviyo_profile_id: string
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  locale: string | null
  klaviyo_subscribed: boolean | null
  klaviyo_suppressed: boolean | null
  klaviyo_synced_at: Date
}

export function mapKlaviyoProfileToContactSnapshot(
  profile: KlaviyoProfileApiResource,
  syncedAt = new Date(),
): KlaviyoContactSnapshot | null {
  const attrs = profile.attributes ?? {}
  const email = normalizeEmail(readString(attrs.email))
  if (!profile.id || !email) return null
  const properties = readObject(attrs.properties)

  return {
    klaviyo_profile_id: profile.id,
    email,
    first_name: readString(attrs.first_name),
    last_name: readString(attrs.last_name),
    phone: readString(attrs.phone_number),
    locale:
      readLocale(attrs.locale) ??
      readLocale(attrs.language) ??
      readLocale(properties?.['PALAS LOCALE']) ??
      readLocale(properties?.Langue),
    klaviyo_subscribed: readMarketingSubscribed(attrs),
    klaviyo_suppressed: readBoolean(attrs.suppressed),
    klaviyo_synced_at: syncedAt,
  }
}

function normalizeEmail(email: string | null): string | null {
  const trimmed = email?.trim().toLowerCase() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readLocale(value: unknown): string | null {
  const raw = readString(value)
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.startsWith('fr')) return 'fr'
  if (lower.startsWith('en')) return 'en'
  return null
}

function readMarketingSubscribed(attrs: Record<string, unknown>): boolean | null {
  const subscriptions = readObject(attrs.subscriptions)
  const email = readObject(subscriptions?.email)
  const marketing = readObject(email?.marketing)
  const consent = readString(marketing?.consent)?.toUpperCase()
  if (consent === 'SUBSCRIBED') return true
  if (consent === 'UNSUBSCRIBED' || consent === 'NEVER_SUBSCRIBED') return false
  return null
}
