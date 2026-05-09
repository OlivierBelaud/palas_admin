// "Ça devrait aussi vous plaire" curation, V1.
// Pool of 7 products, the renderer picks the first 3 NOT already in the cart.
// Sourced from fancypalas.com "you may also like" sections + Shopify Admin
// GraphQL (top BEST_SELLING per category) on 2026-05-09.
//
// Refresh policy: re-curate manually when stock turns or seasonal mix shifts.
// V2 will re-query Shopify dynamically at send time (NOTIF-SUGGEST-DYNAMIC-01).

export type Locale = 'fr' | 'en'

export interface SuggestedProduct {
  title: string
  handle: string
  imageUrl: string
}

// Order matters: first 3 not in cart will be rendered.
export const SUGGESTED_PRODUCTS_POOL: SuggestedProduct[] = [
  {
    title: 'Santa Maria - Necklace Red',
    handle: 'santa-maria-necklace-red',
    imageUrl:
      'https://cdn.shopify.com/s/files/1/0069/8046/8818/files/20231221_PalasPackshot_CollierSantaRed_0047_Crop.jpg?v=1707920001',
  },
  {
    title: 'Frida - Charm',
    handle: 'frida-charm',
    imageUrl:
      'https://cdn.shopify.com/s/files/1/0069/8046/8818/files/09112024_PALAS_PACKSHOT_CharmMiniFrida_003.jpg?v=1772790510',
  },
  {
    title: 'Santa Maria Precious - Necklace White',
    handle: 'santa-maria-precious-necklace-white',
    imageUrl:
      'https://cdn.shopify.com/s/files/1/0069/8046/8818/files/09112024_PALAS_PACKSHOT_Collier_ODC_White_002_CROP.jpg?v=1761120206',
  },
  {
    title: 'Santa Maria - Necklace Shiny Peach',
    handle: 'santa-maria-necklace-shiny-peach',
    imageUrl:
      'https://cdn.shopify.com/s/files/1/0069/8046/8818/files/3_d377c4a6-7455-4b89-91ee-a16236a2202c.png?v=1747144793',
  },
  {
    title: 'Coraçao - Charm',
    handle: 'coracao-charm',
    imageUrl: 'https://cdn.shopify.com/s/files/1/0069/8046/8818/files/TaillePhotoSiteinternet-_4.png?v=1763730601',
  },
  {
    title: 'Calypso - Choker',
    handle: 'calypso-choker',
    imageUrl:
      'https://cdn.shopify.com/s/files/1/0069/8046/8818/files/38_a177f17f-084f-410e-bf20-97752233ff6b.jpg?v=1773665124',
  },
  {
    title: 'Brigitte - Bracelet',
    handle: 'brigitte-bracelet-1',
    imageUrl:
      'https://cdn.shopify.com/s/files/1/0069/8046/8818/files/20231221_PalasPackshot_BraceletBrigitte_0264.jpg?v=1757587707',
  },
]

/** Pick the first N suggested products NOT already in the cart (matched by title). */
export function pickSuggested(cartItemTitles: string[], n = 3): SuggestedProduct[] {
  const inCart = new Set(cartItemTitles.map((t) => t.toLowerCase().trim()))
  const out: SuggestedProduct[] = []
  for (const p of SUGGESTED_PRODUCTS_POOL) {
    if (inCart.has(p.title.toLowerCase().trim())) continue
    out.push(p)
    if (out.length >= n) break
  }
  return out
}

export function suggestedProductUrl(handle: string): string {
  const base = (process.env.FRONT_BASE_URL ?? 'https://fancypalas.com').replace(/\/+$/, '')
  return `${base}/products/${encodeURIComponent(handle)}`
}
