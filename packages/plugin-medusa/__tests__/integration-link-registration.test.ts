// Integration: Register Medusa link definitions and verify:
// 1. Conversion from Medusa DiscoveredLink → Manta ResolvedLink
// 2. LinkService CRUD backed by standard IRepository (InMemoryRepository for tests)
// 3. Compatibility with Medusa workflow step patterns
//
// A link is just a repository table. The LinkService translates
// Medusa's module-keyed format to IRepository calls. That's it.

import { clearLinkRegistry, getRegisteredLinks, InMemoryRepository } from '@manta/core'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearAlerts, getAlerts } from '../src/_internal/alerts'
import { type DiscoveredLink, discoverLinks } from '../src/_internal/discovery/links'
import {
  type ConvertedLink,
  convertMedusaLinks,
  LinkService,
  registerLinksInApp,
} from '../src/_internal/mapping/link-loader'

describe('integration: link registration', () => {
  let links: DiscoveredLink[]

  beforeAll(() => {
    links = discoverLinks()
  })

  beforeEach(() => {
    clearAlerts()
    clearLinkRegistry()
  })

  // ── Medusa → Manta conversion ─────────────

  describe('convertMedusaLinks()', () => {
    let converted: ConvertedLink[]

    beforeEach(() => {
      clearLinkRegistry()
      converted = convertMedusaLinks(links)
    })

    it('converts all links (RW + RO)', () => {
      expect(converted.length).toBe(links.length)
    })

    it('read-write links get a tableName from defineLink()', () => {
      const rw = converted.filter((c) => !c.resolved.isReadOnlyLink)
      expect(rw.length).toBeGreaterThanOrEqual(15)

      for (const link of rw) {
        expect(link.resolved.tableName).toBeDefined()
        expect(link.resolved.leftFk).toBeDefined()
        expect(link.resolved.rightFk).toBeDefined()
      }
    })

    it('read-only links are flagged', () => {
      const ro = converted.filter((c) => c.resolved.isReadOnlyLink)
      expect(ro.length).toBeGreaterThanOrEqual(13)
    })

    it('registers links in Manta core global registry', () => {
      const registered = getRegisteredLinks()
      expect(registered.length).toBe(converted.length)
    })

    it('cart_payment_collection has correct FKs', () => {
      const cpc = converted.find((c) => c.resolved.tableName === 'cart_payment_collection')
      expect(cpc).toBeDefined()
      expect(cpc!.relationships.map((r) => r.foreignKey)).toContain('cart_id')
      expect(cpc!.relationships.map((r) => r.foreignKey)).toContain('payment_collection_id')
    })

    it('known table names from Medusa are present', () => {
      const names = converted.map((c) => c.resolved.tableName)
      for (const expected of ['cart_payment_collection', 'cart_promotion', 'product_sales_channel']) {
        expect(names, `should contain ${expected}`).toContain(expected)
      }
    })
  })

  // ── Registration ──────────────────────────

  it('registerLinksInApp creates LinkService backed by InMemoryRepository', () => {
    const { linkService, result } = registerLinksInApp(links, () => new InMemoryRepository())

    expect(linkService).toBeInstanceOf(LinkService)
    expect(result.readWriteLinks).toBeGreaterThanOrEqual(15)
    expect(result.readOnlyLinks).toBeGreaterThanOrEqual(13)
    expect(result.convertedLinks.length).toBe(links.length)
  })

  it('no error-level alerts', () => {
    registerLinksInApp(links, () => new InMemoryRepository())
    const errors = getAlerts('link').filter((a) => a.level === 'error')
    expect(errors).toHaveLength(0)
  })

  // ── LinkService CRUD ──────────────────────

  describe('LinkService CRUD', () => {
    let svc: LinkService

    beforeEach(() => {
      const { linkService } = registerLinksInApp(links, () => new InMemoryRepository())
      svc = linkService
    })

    it('create() + list() round-trip', async () => {
      await svc.create([{ cart: { cart_id: 'cart_001' }, payment: { payment_collection_id: 'pay_001' } }])
      const entries = await svc.list([{ cart: { cart_id: 'cart_001' }, payment: { payment_collection_id: 'pay_001' } }])
      expect(entries).toHaveLength(1)
    })

    it('create() upserts on same FKs', async () => {
      await svc.create([{ cart: { cart_id: 'c1' }, payment: { payment_collection_id: 'p1' } }])
      await svc.create([{ cart: { cart_id: 'c1' }, payment: { payment_collection_id: 'p1' } }])
      const entries = await svc.list([{ cart: { cart_id: 'c1' }, payment: { payment_collection_id: 'p1' } }])
      expect(entries).toHaveLength(1)
    })

    it('dismiss() soft-deletes', async () => {
      await svc.create([{ cart: { cart_id: 'c2' }, payment: { payment_collection_id: 'p2' } }])
      await svc.dismiss([{ cart: { cart_id: 'c2' }, payment: { payment_collection_id: 'p2' } }])
      expect(await svc.list([{ cart: { cart_id: 'c2' }, payment: { payment_collection_id: 'p2' } }])).toHaveLength(0)
    })

    it('restore() recovers soft-deleted', async () => {
      await svc.create([{ cart: { cart_id: 'c3' }, payment: { payment_collection_id: 'p3' } }])
      await svc.dismiss([{ cart: { cart_id: 'c3' }, payment: { payment_collection_id: 'p3' } }])
      await svc.restore([{ cart: { cart_id: 'c3' }, payment: { payment_collection_id: 'p3' } }])
      expect(await svc.list([{ cart: { cart_id: 'c3' }, payment: { payment_collection_id: 'p3' } }])).toHaveLength(1)
    })

    it('delete() hard-deletes', async () => {
      await svc.create([{ cart: { cart_id: 'c4' }, payment: { payment_collection_id: 'p4' } }])
      await svc.delete([{ cart: { cart_id: 'c4' }, payment: { payment_collection_id: 'p4' } }])
      expect(await svc.list([{ cart: { cart_id: 'c4' }, payment: { payment_collection_id: 'p4' } }])).toHaveLength(0)
    })

    it('delete() grouped format (cascade)', async () => {
      await svc.create([
        { cart: { cart_id: 'c5' }, payment: { payment_collection_id: 'p5a' } },
        { cart: { cart_id: 'c5' }, payment: { payment_collection_id: 'p5b' } },
      ])
      await svc.delete({ cart: { cart_id: ['c5'] } })
      expect(await svc.list([{ cart: { cart_id: 'c5' }, payment: {} }])).toHaveLength(0)
    })

    it('list() asLinkDefinition returns module-keyed format', async () => {
      await svc.create([{ cart: { cart_id: 'c6' }, payment: { payment_collection_id: 'p6' } }])
      const result = await svc.list([{ cart: { cart_id: 'c6' }, payment: { payment_collection_id: 'p6' } }], {
        asLinkDefinition: true,
      })
      expect(result).toHaveLength(1)
      expect(result[0].cart.cart_id).toBe('c6')
      expect(result[0].payment.payment_collection_id).toBe('p6')
    })

    it('different link tables are independent', async () => {
      await svc.create([
        { cart: { cart_id: 'c100' }, payment: { payment_collection_id: 'p100' } },
        { cart: { cart_id: 'c100' }, promotion: { promotion_id: 'promo100' } },
      ])
      expect(await svc.list([{ cart: { cart_id: 'c100' }, payment: { payment_collection_id: 'p100' } }])).toHaveLength(
        1,
      )
      expect(await svc.list([{ cart: { cart_id: 'c100' }, promotion: { promotion_id: 'promo100' } }])).toHaveLength(1)
    })
  })

  // ── Medusa workflow step patterns ─────────

  describe('Medusa workflow step compatibility', () => {
    let svc: LinkService

    beforeEach(() => {
      const { linkService } = registerLinksInApp(links, () => new InMemoryRepository())
      svc = linkService
    })

    it('createRemoteLinkStep: create → dismiss on compensate', async () => {
      const data = [{ product: { product_id: 'prod_1' }, 'sales-channel': { sales_channel_id: 'sc_1' } }]
      await svc.create(data)
      await svc.dismiss(data)
      expect(await svc.list(data)).toHaveLength(0)
    })

    it('dismissRemoteLinkStep: list → dismiss → re-create on compensate', async () => {
      const data = [{ cart: { cart_id: 'cd1' }, payment: { payment_collection_id: 'pd1' } }]
      await svc.create(data)
      const before = await svc.list(data, { asLinkDefinition: true })
      await svc.dismiss(data)
      await svc.create(before)
      expect(await svc.list(data)).toHaveLength(1)
    })

    it('removeRemoteLinkStep: grouped hard-delete', async () => {
      await svc.create([
        { product: { product_id: 'prod_rm' }, 'sales-channel': { sales_channel_id: 'sc_a' } },
        { product: { product_id: 'prod_rm' }, 'sales-channel': { sales_channel_id: 'sc_b' } },
      ])
      await svc.delete({ product: { product_id: ['prod_rm'] } })
      expect(await svc.list([{ product: { product_id: 'prod_rm' }, 'sales-channel': {} }])).toHaveLength(0)
    })
  })
})
