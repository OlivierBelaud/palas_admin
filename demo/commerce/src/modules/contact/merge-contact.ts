export type ContactSignalSource = 'shopify' | 'klaviyo' | 'posthog' | 'palas'

export type ContactSignalKind =
  | 'shopify_customer'
  | 'shopify_order'
  | 'posthog_identity'
  | 'posthog_navigation'
  | 'cart_email_capture'
  | 'klaviyo_profile'
  | 'klaviyo_exchange'
  | 'palas_unsubscribe'

export interface ContactSignal {
  source: ContactSignalSource
  source_kind: ContactSignalKind
  source_id?: string | null
  occurred_at: Date | string

  email?: string | null
  phone?: string | null
  first_name?: string | null
  last_name?: string | null
  locale?: string | null
  country_code?: string | null
  city?: string | null

  shopify_customer_id?: string | null
  klaviyo_profile_id?: string | null
  posthog_distinct_id?: string | null

  orders_count?: number | null
  total_spent?: number | null
  first_order_at?: Date | string | null
  last_order_at?: Date | string | null

  klaviyo_subscribed?: boolean | null
  klaviyo_suppressed?: boolean | null
  email_marketing_opt_out_at?: Date | string | null
}

export interface ContactSnapshot {
  id?: string
  email: string
  phone: string | null
  locale: string
  first_name: string | null
  last_name: string | null
  country_code: string | null
  city: string | null
  shopify_customer_id: string | null
  klaviyo_profile_id: string | null
  distinct_id: string | null
  orders_count: number
  total_spent: number
  first_order_at: Date | string | null
  last_order_at: Date | string | null
  klaviyo_subscribed: boolean
  klaviyo_suppressed: boolean
  email_marketing_opt_out_at: Date | string | null
  shopify_synced_at: Date | string | null
  klaviyo_synced_at: Date | string | null
  last_activity_at: Date | string | null
}

export interface IgnoredContactField {
  field: keyof ContactSnapshot
  reason: string
  current_value: unknown
  incoming_value: unknown
}

export interface ContactMergePlan {
  email_key: string
  patch: Partial<ContactSnapshot>
  changed_fields: Array<keyof ContactSnapshot>
  ignored_fields: IgnoredContactField[]
  creates_contact: boolean
}

const PROFILE_SOURCE_RANK: Record<ContactSignalSource, number> = {
  palas: 4,
  shopify: 3,
  klaviyo: 2,
  posthog: 1,
}

export function normalizeContactEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

export function planContactMerge(existing: ContactSnapshot | null, signal: ContactSignal): ContactMergePlan {
  const email = normalizeContactEmail(signal.email ?? existing?.email)
  if (!email) {
    throw new MantaError('INVALID_DATA', 'Contact merge requires an email')
  }

  const patch: Partial<ContactSnapshot> = {}
  const changedFields: Array<keyof ContactSnapshot> = []
  const ignoredFields: IgnoredContactField[] = []
  const createsContact = existing == null
  const now = normalizeDate(signal.occurred_at)

  setField('email', email, { mode: 'immutable' })
  setField('shopify_customer_id', clean(signal.shopify_customer_id), { mode: 'fill', conflict: 'log' })
  setField('klaviyo_profile_id', clean(signal.klaviyo_profile_id), { mode: 'fill', conflict: 'log' })
  setField('distinct_id', clean(signal.posthog_distinct_id), { mode: 'fill', conflict: 'ignore' })

  setProfileField('phone', clean(signal.phone))
  setProfileField('first_name', clean(signal.first_name))
  setProfileField('last_name', clean(signal.last_name))
  setProfileField('country_code', clean(signal.country_code))
  setProfileField('city', clean(signal.city))

  setLocale(clean(signal.locale))

  if (signal.source === 'shopify') {
    setNumber('orders_count', signal.orders_count)
    setNumber('total_spent', signal.total_spent)
    setField('first_order_at', normalizeNullableDate(signal.first_order_at), { mode: 'replace_if_present' })
    setField('last_order_at', normalizeNullableDate(signal.last_order_at), { mode: 'replace_if_present' })
    setField('shopify_synced_at', now, { mode: 'replace_if_present' })
  }

  if (signal.source === 'klaviyo') {
    setBoolean('klaviyo_subscribed', signal.klaviyo_subscribed)
    setBoolean('klaviyo_suppressed', signal.klaviyo_suppressed)
    setField('klaviyo_synced_at', now, { mode: 'replace_if_present' })
  }

  if (signal.source === 'palas' && signal.email_marketing_opt_out_at) {
    setField('email_marketing_opt_out_at', normalizeDate(signal.email_marketing_opt_out_at), {
      mode: 'fill',
      conflict: 'ignore',
    })
  }

  setField('last_activity_at', now, { mode: 'replace_if_present' })

  return {
    email_key: email,
    patch,
    changed_fields: changedFields,
    ignored_fields: ignoredFields,
    creates_contact: createsContact,
  }

  function current<K extends keyof ContactSnapshot>(field: K): ContactSnapshot[K] | undefined {
    return existing?.[field]
  }

  function record<K extends keyof ContactSnapshot>(field: K, value: ContactSnapshot[K]): void {
    if (value === undefined) return
    if (!createsContact && sameValue(current(field), value)) return
    patch[field] = value
    if (!changedFields.includes(field)) changedFields.push(field)
  }

  function ignore<K extends keyof ContactSnapshot>(field: K, reason: string, incoming: unknown): void {
    ignoredFields.push({
      field,
      reason,
      current_value: current(field),
      incoming_value: incoming,
    })
  }

  function setField<K extends keyof ContactSnapshot>(
    field: K,
    value: ContactSnapshot[K] | undefined | null,
    opts: { mode: 'fill' | 'immutable' | 'replace_if_present'; conflict?: 'ignore' | 'log' },
  ): void {
    if (value == null) return
    const cur = current(field)
    if (opts.mode === 'replace_if_present') {
      record(field, value)
      return
    }
    if (cur == null || cur === '') {
      record(field, value)
      return
    }
    if (sameValue(cur, value)) return
    if (opts.mode === 'immutable') {
      ignore(field, 'immutable_field_conflict', value)
      return
    }
    ignore(field, opts.conflict === 'log' ? 'identity_conflict' : 'existing_value_wins', value)
  }

  function setProfileField<K extends 'phone' | 'first_name' | 'last_name' | 'country_code' | 'city'>(
    field: K,
    value: ContactSnapshot[K] | null,
  ): void {
    if (value == null) return
    const cur = current(field)
    if (cur == null || cur === '') {
      record(field, value)
      return
    }
    if (sameValue(cur, value)) return
    if (PROFILE_SOURCE_RANK[signal.source] >= PROFILE_SOURCE_RANK.shopify) {
      record(field, value)
      return
    }
    ignore(field, 'lower_priority_profile_source', value)
  }

  function setLocale(value: string | null): void {
    if (!value) return
    const normalized = normalizeLocale(value)
    const cur = current('locale')
    if (cur == null || cur === '' || cur === 'fr-FR') {
      record('locale', normalized)
      return
    }
    if (sameValue(cur, normalized)) return
    if (signal.source === 'posthog' && signal.source_kind === 'posthog_navigation') {
      record('locale', normalized)
      return
    }
    ignore('locale', 'existing_locale_wins_without_navigation_signal', normalized)
  }

  function setNumber<K extends 'orders_count' | 'total_spent'>(field: K, value: number | null | undefined): void {
    if (value == null || !Number.isFinite(value)) return
    record(field, value as ContactSnapshot[K])
  }

  function setBoolean<K extends 'klaviyo_subscribed' | 'klaviyo_suppressed'>(
    field: K,
    value: boolean | null | undefined,
  ): void {
    if (value == null) return
    record(field, value as ContactSnapshot[K])
  }
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function normalizeDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function normalizeNullableDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null
  return normalizeDate(value)
}

function normalizeLocale(value: string): string {
  const cleaned = value.trim().toLowerCase()
  if (cleaned.startsWith('fr')) return 'fr'
  return 'en'
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const ad = a instanceof Date ? a : typeof a === 'string' ? new Date(a) : null
    const bd = b instanceof Date ? b : typeof b === 'string' ? new Date(b) : null
    if (ad && bd && !Number.isNaN(ad.getTime()) && !Number.isNaN(bd.getTime())) {
      return ad.getTime() === bd.getTime()
    }
  }
  return a === b
}
