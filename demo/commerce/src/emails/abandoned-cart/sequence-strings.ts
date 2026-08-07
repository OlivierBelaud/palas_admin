import type { Locale } from './strings'

export type AbandonedCartMessageType = 'abandoned_cart_1' | 'abandoned_cart_2' | 'abandoned_cart_3'

interface ReminderCopy {
  subject: string
  preview: string
  heading: string
  promotionHeading: string
  body: string
  promotionBody: string
  cta: string
  promotionCta: string
}

interface AssistanceCopy {
  subject: string
  preview: string
  greeting: string
  intro: string
  practicalIntro: string
  benefits: string[]
  completion: string
  promotionCompletion: string
  cta: string
  signoff: string
}

export const REMINDER_COPY: Record<Locale, ReminderCopy> = {
  fr: {
    subject: "Votre bijou Palas n'attend plus que vous 💗",
    preview: 'Profitez de -10% sur votre commande',
    heading: 'VOTRE BIJOU PALAS N’ATTEND PLUS QUE VOUS',
    promotionHeading: '-10% SUR VOTRE COMMANDE',
    body: 'N’attendez plus pour recevoir votre nouveau bijou et tous les compliments qui vont avec !',
    promotionBody: 'En plus, nous vous offrons -10% sur votre coup de cœur 💝',
    cta: 'JE FINALISE MA COMMANDE',
    promotionCta: '-10% SUR MA COMMANDE',
  },
  en: {
    subject: 'Make it yours today 🌸',
    preview: '10% off your jewellery order',
    heading: 'MAKE IT YOURS TODAY',
    promotionHeading: '10% OFF YOUR ORDER',
    body: 'Don’t wait to receive your new jewellery – and all the compliments that come with it!',
    promotionBody: 'Enjoy 10% off the pieces that make your heart sing 💗',
    cta: 'MAKE IT MINE',
    promotionCta: '10% OFF MY ORDER',
  },
}

export const ASSISTANCE_COPY: Record<Locale, AssistanceCopy> = {
  fr: {
    subject: 'Un doute ? Une question ? Je suis là pour vous ❤️',
    preview: 'Léa répond à toutes vos questions',
    greeting: 'Bonjour',
    intro:
      'Vous avez récemment ajouté quelques bijoux dans votre panier, puis-je vous aider à finaliser votre sélection ? Je me ferai un plaisir de répondre à vos questions.',
    practicalIntro: 'Je glisse quelques informations pratiques pour votre commande :',
    benefits: [
      'Nos bijoux sont en acier inoxydable : ils ne décolorent pas, même au contact de l’eau.',
      'Nous vous offrons les frais de livraison dès 70 € d’achat.',
      'Votre commande sera expédiée en 48 h.',
      'Envie d’une pièce unique ? Contactez-nous pour créer votre bijou personnalisé.',
    ],
    completion: 'Pour finaliser votre commande, il vous suffit de retrouver votre panier.',
    promotionCompletion: 'Vous bénéficierez de -10% avec le code indiqué ci-dessous.',
    cta: 'JE FINALISE MA COMMANDE',
    signoff: 'Belle journée,\nLéa',
  },
  en: {
    subject: "Got a question or not quite sure? I'm here to help ❤️",
    preview: 'Léa is here to answer your questions',
    greeting: 'Hello',
    intro:
      'You recently added a few pieces of jewellery to your basket—can I help you finalise your selection? I’d be more than happy to answer any questions you may have.',
    practicalIntro: 'Here are a few helpful things to know before placing your order:',
    benefits: [
      'Our jewellery is made of stainless steel and won’t tarnish—even when in contact with water.',
      'We offer free delivery on orders over €70.',
      'Your order will be shipped within 48 hours.',
      'Looking for something unique? Get in touch to create your personalised piece.',
    ],
    completion: 'To complete your order, simply return to your basket.',
    promotionCompletion: 'You’ll get 10% off with the code shown below.',
    cta: 'COMPLETE MY ORDER',
    signoff: 'Wishing you a lovely day,\nLéa',
  },
}
