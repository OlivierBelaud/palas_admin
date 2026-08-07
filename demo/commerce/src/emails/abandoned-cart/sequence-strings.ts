import type { Locale } from './strings'

export type AbandonedCartMessageType = 'abandoned_cart_1' | 'abandoned_cart_2' | 'abandoned_cart_3'
export type DiscountKind = 'welcome' | 'recovery'

interface ReminderCopy {
  subject: string
  preview: string
  heading: string
  welcomeHeading: string
  recoveryHeading: string
  body: string
  welcomeBody: string
  recoveryBody: string
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
  welcomeCompletion: string
  recoveryCompletion: string
  cta: string
  signoff: string
}

export const REMINDER_COPY: Record<Locale, ReminderCopy> = {
  fr: {
    subject: "Votre bijou Palas n'attend plus que vous 💗",
    preview: 'Profitez de -10% sur votre commande',
    heading: 'VOTRE BIJOU PALAS N’ATTEND PLUS QUE VOUS',
    welcomeHeading: 'VOTRE REMISE DE BIENVENUE VOUS ATTEND',
    recoveryHeading: '-10% POUR FINALISER VOTRE PANIER',
    body: 'N’attendez plus pour recevoir votre nouveau bijou et tous les compliments qui vont avec !',
    welcomeBody: 'Votre remise de bienvenue de -10% est toujours disponible sur votre panier.',
    recoveryBody: 'Pour vous aider à vous décider, nous vous offrons exceptionnellement -10% sur ce panier 💝',
    cta: 'JE FINALISE MA COMMANDE',
    promotionCta: '-10% SUR MA COMMANDE',
  },
  en: {
    subject: 'Make it yours today 🌸',
    preview: '10% off your jewellery order',
    heading: 'MAKE IT YOURS TODAY',
    welcomeHeading: 'YOUR WELCOME DISCOUNT IS WAITING',
    recoveryHeading: '10% OFF TO COMPLETE YOUR ORDER',
    body: 'Don’t wait to receive your new jewellery – and all the compliments that come with it!',
    welcomeBody: 'Your 10% welcome discount is still available on your basket.',
    recoveryBody: 'To help you decide, we’re offering you an exceptional 10% off this basket 💗',
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
    welcomeCompletion: 'Votre remise de bienvenue de -10% est toujours disponible avec le code ci-dessous.',
    recoveryCompletion: 'Pour vous aider à finaliser ce panier, nous vous offrons -10% avec le code ci-dessous.',
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
    welcomeCompletion: 'Your 10% welcome discount is still available with the code shown below.',
    recoveryCompletion: 'To help you complete this basket, we’re offering you 10% off with the code shown below.',
    cta: 'COMPLETE MY ORDER',
    signoff: 'Wishing you a lovely day,\nLéa',
  },
}
