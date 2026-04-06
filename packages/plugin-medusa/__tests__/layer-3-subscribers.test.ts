// Layer 3: Subscriber discovery tests

import { beforeAll, describe, expect, it } from 'vitest'
import { clearAlerts, getAlerts } from '../src/_internal/alerts'
import { type DiscoveredSubscriber, discoverSubscribers } from '../src/_internal/discovery/subscribers'

describe('layer-3: subscribers', () => {
  let subscribers: DiscoveredSubscriber[]

  beforeAll(() => {
    clearAlerts()
    subscribers = discoverSubscribers()
  })

  it('discovers at least 2 subscribers', () => {
    expect(subscribers.length).toBeGreaterThanOrEqual(2)
  })

  it('each subscriber has a handler', () => {
    for (const sub of subscribers) {
      expect(sub.hasHandler).toBe(true)
    }
  })

  it('each subscriber has event config', () => {
    for (const sub of subscribers) {
      expect(sub.events.length).toBeGreaterThan(0)
    }
  })

  it('no error-level alerts', () => {
    const errors = getAlerts('subscriber').filter((a) => a.level === 'error')
    expect(errors).toHaveLength(0)
  })
})
