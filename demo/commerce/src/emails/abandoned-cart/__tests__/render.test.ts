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
    expect(out.html).toContain('solana.jpg?width=840&amp;format=pjpg')
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
    expect(out.html).toContain('d152e8a0-e093-4403-acf9-047d079d8abd') // decorative palm
    expect(out.html).toContain('2982a0eb-5e22-4e4c-8bd2-da690775978a') // footer palm
    expect(out.html).toMatch(new RegExp(`<h1[^>]*>${STRINGS.fr.heading}</h1>`))
    expect(out.html).not.toMatch(new RegExp(`<img[^>]*alt="${STRINGS.fr.heading}"`))
    expect(out.html).toContain('class="email-container"')
    expect(out.html).not.toMatch(/<a[^>]*><img[^>]*><p/i)
    const productTitleLinkStyle = out.html.match(/<a[^>]*style="([^"]*)"[^>]*>Bracelet Solana<\/a>/)?.[1]
    expect(productTitleLinkStyle).toContain('color:#000000')
    expect(productTitleLinkStyle).toContain('text-decoration:underline')
    // Both items rendered
    expect(out.html).toContain('Bracelet Solana')
    expect(out.html).toContain('Collier Aurora')
    expect(out.html).toContain('solana.jpg?width=520&amp;format=pjpg')
    expect(out.html).toContain('width=340')
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
    expect(out.html).toContain(STRINGS.en.heading)
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

  it('renders Email 2 with the Klaviyo reminder design and shared footer', async () => {
    const out = await renderAbandonedCart({
      messageType: 'abandoned_cart_2',
      locale: 'fr',
      firstName: 'Alice',
      items: FIXTURE_ITEMS,
      recoveryUrl: RECOVERY,
      unsubscribeUrl: UNSUB,
      discountCode: 'PALAS10-ABC1234',
    })

    expect(out.subject).toBe("Votre bijou Palas n'attend plus que vous 💗")
    expect(out.html).toContain('2ad06794-ddad-4fe8-a9f8-770c54dcf786')
    expect(out.html).toContain('VOTRE REMISE DE BIENVENUE VOUS ATTEND')
    expect(out.html).toContain('Nunito Sans')
    expect(out.html).toContain('PALAS10-ABC1234')
    expect(out.html).toContain('2982a0eb-5e22-4e4c-8bd2-da690775978a')
    expect(out.html).toContain('vous désabonner')
    expect(out.html).toContain('VOTRE PANIER')
    expect(out.html).toContain('Bracelet Solana')
    expect(out.html).toContain('Collier Aurora')
  })

  it('renders Email 3 as a personal assistance note with the shared reassurance and footer', async () => {
    const out = await renderAbandonedCart({
      messageType: 'abandoned_cart_3',
      locale: 'en',
      firstName: 'Alice',
      items: FIXTURE_ITEMS,
      recoveryUrl: RECOVERY,
      unsubscribeUrl: UNSUB,
    })

    expect(out.subject).toBe("Got a question or not quite sure? I'm here to help ❤️")
    expect(out.html).toContain('d5b52b1f-3aa4-480c-9280-f8de3944b486')
    expect(out.text).toContain('Hello Alice,')
    expect(out.text).toContain('Your order will be shipped within 48 hours.')
    expect(out.html).toContain('51f1c760-8a3f-4140-8188-c1af2ac562ed')
    expect(out.html).toContain('2982a0eb-5e22-4e4c-8bd2-da690775978a')
    expect(out.html).toContain('unsubscribe')
    expect(out.html).not.toContain('PALAS10-ABC1234')
    expect(out.html).toContain('font-family:Times')
    expect(out.html).toContain('YOUR BASKET')
    expect(out.html).toContain('Bracelet Solana')
    expect(out.html).toContain('Collier Aurora')
  })

  it('distinguishes a returning-customer recovery offer from a welcome discount', async () => {
    const out = await renderAbandonedCart({
      messageType: 'abandoned_cart_2',
      locale: 'fr',
      firstName: 'Alice',
      items: FIXTURE_ITEMS,
      recoveryUrl: `${RECOVERY}?discount=PANIER10-ABC1234`,
      unsubscribeUrl: UNSUB,
      discountCode: 'PANIER10-ABC1234',
      discountKind: 'recovery',
    })

    expect(out.html).toContain('-10% POUR FINALISER VOTRE PANIER')
    expect(out.html).toContain('PANIER10-ABC1234')
    expect(out.html).not.toContain('REMISE DE BIENVENUE')
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
