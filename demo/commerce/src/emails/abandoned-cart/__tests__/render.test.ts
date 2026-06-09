// Render snapshot tests for the abandoned-cart email — FR + EN.
// V1 design: NO prices in the email. Tests check structure, locale
// switching, item titles, and absence of currency strings.

import { describe, expect, it } from 'vitest'
import { renderAbandonedCart } from '../render'
import { STRINGS } from '../strings'

const FIXTURE_ITEMS = [
  {
    id: 'gid://shopify/ProductVariant/1',
    title: 'Bracelet Solana',
    quantity: 1,
    image_url: 'https://cdn.shopify.com/s/files/test/solana.jpg',
  },
  {
    id: 'gid://shopify/ProductVariant/2',
    title: 'Collier Aurora',
    quantity: 2,
    // no image_url → placeholder used
  },
]

const RECOVERY = 'https://fancypalas.com/checkouts/cn/abc/recover'
const UNSUB = 'https://admin.fancypalas.com/unsubscribe?token=cart_1'

describe('renderAbandonedCart', () => {
  it('renders Hero layout (1 product) with suggested products grid', async () => {
    const out = await renderAbandonedCart({
      locale: 'fr',
      firstName: 'Alice',
      items: [FIXTURE_ITEMS[0]],
      recoveryUrl: RECOVERY,
      unsubscribeUrl: UNSUB,
    })

    expect(out.subject).toBe(STRINGS.fr.subject)
    expect(out.html).toContain('Bracelet Solana')
    // No Quantity label in Hero layout (single product, qty info redundant)
    expect(out.html).not.toContain('Quantité')
    // Suggested products grid present (1 product → ≤2 → show grid)
    expect(out.html).toContain('Ça devrait aussi vous plaire')
    expect(out.html).toContain('santa-maria-necklace-red')
    // No prices anywhere
    expect(out.html).not.toMatch(/€\s*\d/)
  })

  it('renders Duo layout (2 products) with suggested products grid', async () => {
    const out = await renderAbandonedCart({
      locale: 'fr',
      firstName: 'Alice',
      items: FIXTURE_ITEMS,
      recoveryUrl: RECOVERY,
      unsubscribeUrl: UNSUB,
    })

    // Cloudfront assets present
    expect(out.html).toContain('3d0122af-ab8b-40df-b454-dad4088a01d8') // logo banner
    expect(out.html).toContain('5133aaec-abc9-49b1-b93c-4feb18894cc1') // hero
    expect(out.html).toContain('d152e8a0-e093-4403-acf9-047d079d8abd') // decorative palm
    expect(out.html).toContain('2982a0eb-5e22-4e4c-8bd2-da690775978a') // footer palm
    // Both items rendered
    expect(out.html).toContain('Bracelet Solana')
    expect(out.html).toContain('Collier Aurora')
    // Duo layout = no Quantity label (qty info inutile when each item is qty=1)
    expect(out.html).not.toContain('Quantité')
    // Suggested grid still present (2 items → ≤2 → show)
    expect(out.html).toContain('Ça devrait aussi vous plaire')
    // CTAs wired
    expect(out.html).toContain(RECOVERY)
    expect(out.html).toContain('FINALISER MA COMMANDE')
    expect(out.html).toContain(UNSUB)
    // No prices
    expect(out.html).not.toMatch(/€\s*\d/)
    expect(out.text).toContain('Bracelet Solana')
  })

  it('renders List layout (3+ products) WITHOUT suggested products grid', async () => {
    const out = await renderAbandonedCart({
      locale: 'fr',
      firstName: 'Alice',
      items: [...FIXTURE_ITEMS, { id: 'gid://shopify/ProductVariant/3', title: 'Coraçao - Charm', quantity: 1 }],
      recoveryUrl: RECOVERY,
      unsubscribeUrl: UNSUB,
    })

    // Suggested products NOT shown (3+ items → no grid)
    expect(out.html).not.toContain('Ça devrait aussi vous plaire')
    // All 3 items rendered
    expect(out.html).toContain('Bracelet Solana')
    expect(out.html).toContain('Collier Aurora')
    expect(out.html).toContain('Coraçao - Charm')
    // No grey background — must look like Duo (white)
    expect(out.html).not.toMatch(/background-color:#f5f5f5/i)
    // No "Quantité" label (image + title underlined, qty omitted)
    expect(out.html).not.toContain('Quantité')
  })

  it('renders EN template with EN copy and EN suggested heading', async () => {
    const out = await renderAbandonedCart({
      locale: 'en',
      firstName: 'Bob',
      items: [FIXTURE_ITEMS[0]],
      recoveryUrl: RECOVERY,
      unsubscribeUrl: UNSUB,
    })

    expect(out.subject).toBe(STRINGS.en.subject)
    expect(out.html).toContain('Your favorite jewels are waiting')
    expect(out.html).toContain('COMPLETE MY ORDER')
    expect(out.html).toContain('You may also like')
    expect(out.html).not.toMatch(/€\s*\d/)
  })

  it('renders welcome discount code when supplied', async () => {
    const out = await renderAbandonedCart({
      locale: 'fr',
      firstName: 'Alice',
      items: [FIXTURE_ITEMS[0]],
      recoveryUrl: `${RECOVERY}?discount=PALAS10-ABC1234`,
      unsubscribeUrl: UNSUB,
      discountCode: 'PALAS10-ABC1234',
    })

    expect(out.html).toContain('PALAS10-ABC1234')
    expect(out.html).toContain('Code promo')
    expect(out.html).toContain('discount=PALAS10-ABC1234')
    expect(out.text).toContain('PALAS10-ABC1234')
  })

  it('handles empty items array without crashing (no suggested grid)', async () => {
    const out = await renderAbandonedCart({
      locale: 'fr',
      firstName: null,
      items: [],
      recoveryUrl: RECOVERY,
      unsubscribeUrl: UNSUB,
    })

    expect(out.html.length).toBeGreaterThan(100)
    expect(out.html).toContain('FINALISER MA COMMANDE')
    expect(out.html).toContain('vous désabonner')
    // 0 items → no suggested grid (only shown when 1 ≤ items.length ≤ 2)
    expect(out.html).not.toContain('Ça devrait aussi vous plaire')
  })
})
