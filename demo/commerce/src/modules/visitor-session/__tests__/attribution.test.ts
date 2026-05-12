// Unit tests for the pure attribution helpers used by visitor-session.
// Cover: D2 paid-source matrix, attribution field extraction, $session_id
// presence/absence.

import { describe, expect, it } from 'vitest'
import { extractAttribution, extractSessionId, isPaidSession } from '../attribution'

describe('isPaidSession', () => {
  describe('utm_medium', () => {
    it.each([
      ['cpc', true],
      ['paid', true],
      ['ppc', true],
      ['CPC', true],
      ['Paid', true],
      ['organic', false],
      ['email', false],
      ['social', false],
      ['', false],
    ])('utm_medium=%s → %s', (medium, expected) => {
      expect(isPaidSession({ utm_medium: medium })).toBe(expected)
    })
  })

  describe('utm_source', () => {
    it.each([
      ['google_ads', true],
      ['meta_ads', true],
      ['tiktok_ads', true],
      ['facebook_ads', true],
      ['bing_ads', true],
      ['klaviyo', true],
      ['GOOGLE_ADS', true],
      ['Klaviyo', true],
      ['google', false],
      ['facebook', false],
      ['newsletter', false],
      ['organic', false],
    ])('utm_source=%s → %s', (source, expected) => {
      expect(isPaidSession({ utm_source: source })).toBe(expected)
    })
  })

  describe('current_url click ids', () => {
    it.each([
      ['https://example.com/?gclid=abc123', true],
      ['https://example.com/?fbclid=abc123', true],
      ['https://example.com/?ttclid=abc123', true],
      ['https://example.com/?GCLID=abc', true],
      ['https://example.com/?foo=1&gclid=abc', true],
      ['https://example.com/path?utm_source=newsletter&fbclid=abc', true],
      ['https://example.com/', false],
      ['https://example.com/?utm_source=newsletter', false],
      // gclid as bare substring (no ?/& boundary, no =) should NOT match
      ['https://example.com/path/gclid-blog-post', false],
    ])('current_url=%s → %s', (url, expected) => {
      expect(isPaidSession({ current_url: url })).toBe(expected)
    })
  })

  it('returns false when all inputs are null/undefined', () => {
    expect(isPaidSession({})).toBe(false)
    expect(isPaidSession({ current_url: null, utm_source: null, utm_medium: null })).toBe(false)
  })

  it('returns true when ANY rule matches (combination)', () => {
    expect(
      isPaidSession({
        utm_source: 'newsletter',
        utm_medium: 'organic',
        current_url: 'https://example.com/?gclid=x',
      }),
    ).toBe(true)
  })
})

describe('extractAttribution', () => {
  it('extracts all attribution fields from a populated event', () => {
    const out = extractAttribution({
      properties: {
        $current_url: 'https://example.com/?utm_source=google_ads&utm_medium=cpc&utm_campaign=spring',
        utm_source: 'google_ads',
        utm_medium: 'cpc',
        utm_campaign: 'spring',
        $referring_domain: 'google.com',
      },
    })
    expect(out).toEqual({
      first_url: 'https://example.com/?utm_source=google_ads&utm_medium=cpc&utm_campaign=spring',
      utm_source: 'google_ads',
      utm_medium: 'cpc',
      utm_campaign: 'spring',
      referring_domain: 'google.com',
      is_paid_session: true,
    })
  })

  it('returns nulls when properties are absent', () => {
    const out = extractAttribution({ properties: {} })
    expect(out).toEqual({
      first_url: null,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      referring_domain: null,
      is_paid_session: false,
    })
  })

  it('returns nulls when properties is undefined', () => {
    const out = extractAttribution({})
    expect(out.first_url).toBeNull()
    expect(out.utm_source).toBeNull()
    expect(out.is_paid_session).toBe(false)
  })

  it('treats empty strings as null', () => {
    const out = extractAttribution({
      properties: { $current_url: '   ', utm_source: '', utm_medium: '  ' },
    })
    expect(out.first_url).toBeNull()
    expect(out.utm_source).toBeNull()
    expect(out.utm_medium).toBeNull()
  })

  it('falls back to non-dollar-prefixed `current_url` / `referring_domain`', () => {
    const out = extractAttribution({
      properties: {
        current_url: 'https://example.com/',
        referring_domain: 'fancypalas.com',
      },
    })
    expect(out.first_url).toBe('https://example.com/')
    expect(out.referring_domain).toBe('fancypalas.com')
  })

  it('detects paid via gclid even when utm_* are unrelated', () => {
    const out = extractAttribution({
      properties: { $current_url: 'https://example.com/?gclid=Z', utm_source: 'newsletter' },
    })
    expect(out.is_paid_session).toBe(true)
  })
})

describe('extractSessionId', () => {
  it('returns the $session_id when present', () => {
    expect(extractSessionId({ properties: { $session_id: 'sess_abc' } })).toBe('sess_abc')
  })

  it('returns null when $session_id is missing', () => {
    expect(extractSessionId({ properties: {} })).toBeNull()
  })

  it('returns null when properties is missing', () => {
    expect(extractSessionId({})).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(extractSessionId({ properties: { $session_id: '' } })).toBeNull()
  })

  it('returns null for a non-string value', () => {
    expect(extractSessionId({ properties: { $session_id: 123 as unknown as string } })).toBeNull()
  })
})
