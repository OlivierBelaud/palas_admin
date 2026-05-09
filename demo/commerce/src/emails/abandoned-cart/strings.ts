// All copy for the abandoned-cart email, FR + EN. Strict: no per-customer
// substitution at the string level (firstName etc. live in the React tree).
//
// Subjects are kept short (<= 50 chars) so most desktop and mobile clients
// don't truncate them. Preview lines (preheader) are the short teaser shown
// after the subject in some clients — kept consistent with subHeading.

export type Locale = 'fr' | 'en'

export interface AbandonedCartStrings {
  subject: string
  preview: string
  heading: string
  subHeading: string
  /** First sentence of the body — rendered in regular weight. */
  body: string
  /** Optional emphasized fragment appended to body, rendered in bold. */
  bodyEmphasis?: string
  cta1: string
  cta2: string
  suggestedHeading: string
  uspsHeading: string
  usp1Title: string
  usp1Body: string
  usp2Title: string
  usp2Body: string
  usp3Title: string
  usp3Body: string
  usp4Title: string
  usp4Body: string
  quantityLabel: string
  totalLabel: string
  contactBefore: string
  unsubscribeBefore: string
  unsubscribeLink: string
}

export const STRINGS: Record<Locale, AbandonedCartStrings> = {
  fr: {
    subject: 'Vos bijoux favoris vous attendent',
    preview: 'Mais pas pour longtemps !',
    heading: 'Vos bijoux favoris vous attendent',
    subHeading: 'Mais pas pour longtemps !',
    // TEMPORAIRE — opération Fête des Mères 2026. À ré-évaluer post-25/05/2026.
    body: 'Et pour la fête des mères, ',
    bodyEmphasis: 'profitez de -15% sur toute la collection 💝',
    cta1: 'FINALISER MA COMMANDE',
    cta2: 'RETROUVER MON PANIER',
    suggestedHeading: 'Ça devrait aussi vous plaire',
    uspsHeading: 'Les bijoux Palas sont :',
    usp1Title: 'Handmade',
    usp1Body: 'assemblés à la main à Lisbonne',
    usp2Title: 'Waterproof',
    usp2Body: "Résistants à l'eau claire et salée",
    usp3Title: 'Préparation express',
    usp3Body: 'des commandes',
    usp4Title: 'Garantie 6 mois',
    usp4Body: 'pour tous nos bijoux',
    quantityLabel: 'Quantité',
    totalLabel: 'Total',
    contactBefore: 'Nous sommes à votre écoute, si vous avez la moindre question écrivez nous à ',
    unsubscribeBefore:
      "Vous ne souhaitez plus recevoir d'emails de notre part ? 😢 Vous pouvez cliquez juste ici pour ",
    unsubscribeLink: 'vous désabonner',
  },
  en: {
    subject: 'Your favorite jewels are waiting',
    preview: 'But not for long!',
    heading: 'Your favorite jewels are waiting',
    subHeading: 'But not for long!',
    // TEMPORARY — Mother's Day 2026 promo. Re-evaluate after 25/05/2026.
    body: "And for Mother's Day, ",
    bodyEmphasis: 'enjoy -15% off the entire collection 💝',
    cta1: 'COMPLETE MY ORDER',
    cta2: 'RETURN TO MY CART',
    suggestedHeading: 'You may also like',
    uspsHeading: 'PALAS jewelry is:',
    usp1Title: 'Handmade',
    usp1Body: 'assembled by hand in Lisbon',
    usp2Title: 'Waterproof',
    usp2Body: 'Resistant to fresh and salt water',
    usp3Title: 'Express prep',
    usp3Body: 'on every order',
    usp4Title: '6-month warranty',
    usp4Body: 'on all our jewelry',
    quantityLabel: 'Quantity',
    totalLabel: 'Total',
    contactBefore: 'We are here to help, if you have any question email us at ',
    unsubscribeBefore: 'No longer want to hear from us? 😢 You can click right here to ',
    unsubscribeLink: 'unsubscribe',
  },
}
