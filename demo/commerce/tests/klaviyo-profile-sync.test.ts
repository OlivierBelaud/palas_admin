import { describe, expect, it } from 'vitest'
import { mapKlaviyoProfileToContactSnapshot } from '../src/modules/contact/klaviyo-profile-sync'

describe('mapKlaviyoProfileToContactSnapshot', () => {
  it('maps Klaviyo profile identity, consent, and PALAS locale properties', () => {
    const snapshot = mapKlaviyoProfileToContactSnapshot(
      {
        id: '01ABC',
        attributes: {
          email: ' Jane@Example.COM ',
          first_name: 'Jane',
          last_name: 'Doe',
          phone_number: '+33611111111',
          subscriptions: {
            email: {
              marketing: {
                consent: 'SUBSCRIBED',
              },
            },
          },
          properties: {
            'PALAS LOCALE': 'fr-FR',
          },
        },
      },
      new Date('2026-06-16T10:00:00Z'),
    )

    expect(snapshot).toMatchObject({
      klaviyo_profile_id: '01ABC',
      email: 'jane@example.com',
      first_name: 'Jane',
      last_name: 'Doe',
      phone: '+33611111111',
      locale: 'fr',
      klaviyo_subscribed: true,
      klaviyo_suppressed: null,
      klaviyo_synced_at: new Date('2026-06-16T10:00:00Z'),
    })
  })

  it('returns null when the profile has no email', () => {
    expect(mapKlaviyoProfileToContactSnapshot({ id: '01ABC', attributes: {} })).toBe(null)
  })

  it('maps unsubscribe consent as false', () => {
    const snapshot = mapKlaviyoProfileToContactSnapshot({
      id: '01ABC',
      attributes: {
        email: 'jane@example.com',
        subscriptions: {
          email: {
            marketing: {
              consent: 'UNSUBSCRIBED',
            },
          },
        },
      },
    })

    expect(snapshot?.klaviyo_subscribed).toBe(false)
  })
})
