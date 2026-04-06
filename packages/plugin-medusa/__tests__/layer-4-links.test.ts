// Layer 4: Link discovery tests

import { beforeAll, describe, expect, it } from 'vitest'
import { clearAlerts, getAlerts } from '../src/_internal/alerts'
import { type DiscoveredLink, discoverLinks } from '../src/_internal/discovery/links'

describe('layer-4: links', () => {
  let links: DiscoveredLink[]

  beforeAll(() => {
    clearAlerts()
    links = discoverLinks()
  })

  it('discovers >= 30 links', () => {
    expect(links.length).toBeGreaterThanOrEqual(30)
  })

  it('has read-write pivot table links', () => {
    const rw = links.filter((l) => !l.isReadOnly)
    expect(rw.length).toBeGreaterThanOrEqual(15)
  })

  it('has read-only FK links', () => {
    const ro = links.filter((l) => l.isReadOnly)
    expect(ro.length).toBeGreaterThanOrEqual(10)
  })

  it('each link has a service name', () => {
    for (const link of links) {
      expect(link.serviceName).toBeDefined()
      expect(link.serviceName.length).toBeGreaterThan(0)
    }
  })

  it('CartPaymentCollection link exists', () => {
    const cartPayment = links.find((l) => l.exportName === 'CartPaymentCollection')
    expect(cartPayment).toBeDefined()
    expect(cartPayment!.isReadOnly).toBe(false)
  })

  it('read-only links have isReadOnly: true', () => {
    const ro = links.filter((l) => l.isReadOnly)
    for (const link of ro) {
      expect(link.isReadOnly).toBe(true)
    }
  })

  it('no error-level alerts', () => {
    const errors = getAlerts('link').filter((a) => a.level === 'error')
    expect(errors).toHaveLength(0)
  })
})
