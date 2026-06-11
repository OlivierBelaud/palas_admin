import { describe, expect, it } from 'vitest'
import { pickLocale } from './pick-locale'

describe('pickLocale', () => {
  const cases: Array<{
    name: string
    input: { browserLocale?: string | null; contactLocale?: string | null; countryCode?: string | null }
    expected: 'fr' | 'en'
  }> = [
    // ── Navigation language wins over everything ──────────────────────
    { name: 'browser fr-FR wins', input: { browserLocale: 'fr-FR' }, expected: 'fr' },
    { name: 'browser en-US wins', input: { browserLocale: 'en-US' }, expected: 'en' },
    {
      name: 'browser fr beats wrong contact locale en-US',
      input: { browserLocale: 'fr-FR', contactLocale: 'en-US' },
      expected: 'fr',
    },
    {
      name: 'browser fr beats non-FR country',
      input: { browserLocale: 'fr', countryCode: 'US' },
      expected: 'fr',
    },
    {
      name: 'unknown browser base de-DE ignored, falls through to country FR',
      input: { browserLocale: 'de-DE', countryCode: 'FR' },
      expected: 'fr',
    },
    // ── THE BUG FIX: FR country must NOT get English from a stale contact locale ──
    {
      name: 'FR country beats wrong contact locale en-US (no nav signal)',
      input: { contactLocale: 'en-US', countryCode: 'FR' },
      expected: 'fr',
    },
    // ── Contact locale only as last resort ────────────────────────────
    { name: 'fr-FR contact locale (last resort)', input: { contactLocale: 'fr-FR' }, expected: 'fr' },
    { name: 'en-US contact locale (last resort)', input: { contactLocale: 'en-US' }, expected: 'en' },
    { name: 'en-GB contact locale (last resort)', input: { contactLocale: 'en-GB' }, expected: 'en' },
    {
      name: 'unknown locale base de-DE falls back to country FR',
      input: { contactLocale: 'de-DE', countryCode: 'FR' },
      expected: 'fr',
    },
    { name: 'no locale + BE → fr', input: { contactLocale: null, countryCode: 'BE' }, expected: 'fr' },
    { name: 'no locale + CH → fr', input: { countryCode: 'CH' }, expected: 'fr' },
    { name: 'no locale + LU → fr', input: { countryCode: 'LU' }, expected: 'fr' },
    { name: 'no locale + MC → fr', input: { countryCode: 'MC' }, expected: 'fr' },
    { name: 'no locale + US → en', input: { contactLocale: null, countryCode: 'US' }, expected: 'en' },
    { name: 'no locale + GB → en', input: { countryCode: 'GB' }, expected: 'en' },
    { name: 'all null → fr fallback', input: { contactLocale: null, countryCode: null }, expected: 'fr' },
    { name: 'empty locale + null country → fr', input: { contactLocale: '', countryCode: null }, expected: 'fr' },
    { name: 'lowercase country code accepted', input: { countryCode: 'fr' }, expected: 'fr' },
    { name: 'underscore separator fr_FR', input: { contactLocale: 'fr_FR' }, expected: 'fr' },
  ]

  for (const c of cases) {
    it(c.name, () => {
      expect(pickLocale(c.input)).toBe(c.expected)
    })
  }
})
