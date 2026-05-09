// Resolve the email locale from whatever signals we have on the cart/contact.
//
// Priority:
//   1. contact.locale (BCP-47, e.g. 'fr-FR') — strongest signal, set by the
//      contact-upsert path.
//   2. cart.country_code (ISO-3166-1 alpha-2) — French-speaking countries
//      → 'fr', everything else → 'en'.
//   3. fallback → 'fr' (the home market).

import type { Locale } from './strings'

const FRENCH_SPEAKING_COUNTRIES = new Set(['FR', 'BE', 'CH', 'LU', 'MC'])

export function pickLocale(input: { contactLocale?: string | null; countryCode?: string | null }): Locale {
  // 1. Contact locale wins if it's a known base.
  if (input.contactLocale) {
    const base = input.contactLocale.split(/[-_]/)[0]?.toLowerCase()
    if (base === 'fr' || base === 'en') return base
  }

  // 2. Fall back to country code.
  if (input.countryCode) {
    const code = input.countryCode.toUpperCase()
    return FRENCH_SPEAKING_COUNTRIES.has(code) ? 'fr' : 'en'
  }

  // 3. Default to French.
  return 'fr'
}
