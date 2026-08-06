import type { RenderedEmail } from '../abandoned-cart/render'
import type { Locale } from '../abandoned-cart/strings'

export interface PaymentHelpEmailInput {
  locale: Locale
  firstName?: string | null
  recoveryUrl: string
  unsubscribeUrl: string
}

export function renderPaymentHelpEmail(input: PaymentHelpEmailInput): RenderedEmail {
  const isEnglish = input.locale === 'en'
  const greeting = input.firstName
    ? isEnglish
      ? `Hello ${input.firstName},`
      : `Bonjour ${input.firstName},`
    : isEnglish
      ? 'Hello,'
      : 'Bonjour,'
  const subject = isEnglish ? 'Need help finalising your order?' : 'Besoin d’aide pour finaliser votre commande ?'
  const body = isEnglish
    ? 'We noticed your order was not finalised. If something blocked you on the site, reply directly to this email and we will help.'
    : 'Votre commande n’a pas été finalisée. Si quelque chose vous a bloqué sur le site, répondez directement à cet email et on vous aidera.'
  const cta = isEnglish ? 'Return to my cart' : 'Retrouver mon panier'
  const unsubscribe = isEnglish ? 'Unsubscribe' : 'Se désinscrire'
  const text = isEnglish
    ? `${greeting}\n\n${body}\n\nYou can also return to your cart here: ${input.recoveryUrl}\n\nUnsubscribe: ${input.unsubscribeUrl}`
    : `${greeting}\n\n${body}\n\nVous pouvez aussi retrouver votre panier ici : ${input.recoveryUrl}\n\nDésinscription : ${input.unsubscribeUrl}`

  return {
    subject,
    text,
    html: `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#222">
      <p>${greeting}</p>
      <p>${body}</p>
      <p><a href="${input.recoveryUrl}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;text-decoration:none;border-radius:4px">${cta}</a></p>
      <p style="font-size:12px;color:#777"><a href="${input.unsubscribeUrl}">${unsubscribe}</a></p>
    </div>`,
  }
}
