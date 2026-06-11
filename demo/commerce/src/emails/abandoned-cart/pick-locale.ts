// Resolve the email locale from whatever signals we have on the cart/contact.
//
// Priority (navigation-first — see state/ABANDONED_CART_EMAIL_AUDIT):
//   1. browserLocale — the navigation language captured from the storefront:
//      the display locale the visitor browsed in if available, else the
//      browser language ($browser_language). Freshest, most reliable signal.
//   2. cart.country_code (ISO-3166-1 alpha-2) — French-speaking countries
//      → 'fr', everything else → 'en'.
//   3. contact.locale (BCP-47) — LAST resort only. It is frequently wrong
//      (Shopify customer locale defaults to 'en' for many FR customers), so
//      it must never override a real navigation or country signal.
//   4. fallback → 'fr' (the home market).

import type { Locale } from './strings'

const FRENCH_SPEAKING_COUNTRIES = new Set(['FR', 'BE', 'CH', 'LU', 'MC'])

function baseLocale(value?: string | null): Locale | null {
  if (!value) return null
  const base = value.split(/[-_]/)[0]?.toLowerCase()
  if (base === 'fr' || base === 'en') return base
  return null
}

export function pickLocale(input: {
  browserLocale?: string | null
  contactLocale?: string | null
  countryCode?: string | null
}): Locale {
  // 1. Navigation language (storefront display locale, else browser language).
  const nav = baseLocale(input.browserLocale)
  if (nav) return nav

  // 2. Cart country code.
  if (input.countryCode) {
    const code = input.countryCode.toUpperCase()
    return FRENCH_SPEAKING_COUNTRIES.has(code) ? 'fr' : 'en'
  }

  // 3. Contact locale — last resort (often stale/wrong).
  const contact = baseLocale(input.contactLocale)
  if (contact) return contact

  // 4. Default to French.
  return 'fr'
}
