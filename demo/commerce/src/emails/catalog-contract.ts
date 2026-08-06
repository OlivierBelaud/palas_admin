import type { RenderedEmail } from './abandoned-cart/render'
import type { Locale } from './abandoned-cart/strings'

export const EMAIL_TEMPLATE_IDS = [
  'abandoned_cart_1',
  'abandoned_cart_2',
  'abandoned_cart_3',
  'payment_help_1',
  'admin_invite',
  'daily_reporting',
] as const

export type EmailTemplateId = (typeof EMAIL_TEMPLATE_IDS)[number]
export type CustomerStatus = 'new' | 'returning'
export type ReportStatus = 'ready' | 'partial'
export type PreviewControl = 'locale' | 'customerStatus' | 'promotionActive' | 'itemCount' | 'reportStatus'

export interface EmailTemplateDefinition {
  id: EmailTemplateId
  name: string
  family: 'customer' | 'admin' | 'reporting'
  description: string
  timing: string
  source: string
  controls: PreviewControl[]
  sharedTemplate?: string
}

export interface EmailTemplatePreviewInput {
  templateId: EmailTemplateId
  locale: Locale
  customerStatus: CustomerStatus
  promotionActive: boolean
  itemCount: number
  reportStatus: ReportStatus
}

export interface RenderedEmailTemplatePreview extends RenderedEmail {
  appliedBranches: string[]
}

export function sameEmailPreviewScenario(left: EmailTemplatePreviewInput, right: EmailTemplatePreviewInput): boolean {
  return (
    left.templateId === right.templateId &&
    left.locale === right.locale &&
    left.customerStatus === right.customerStatus &&
    left.promotionActive === right.promotionActive &&
    left.itemCount === right.itemCount &&
    left.reportStatus === right.reportStatus
  )
}

export const EMAIL_TEMPLATE_CATALOG: EmailTemplateDefinition[] = [
  {
    id: 'abandoned_cart_1',
    name: 'Panier abandonné · Email 1',
    family: 'customer',
    description: 'Première relance après abandon du panier.',
    timing: '2 heures après la dernière activité',
    source: 'emails/abandoned-cart/AbandonedCartEmail.tsx',
    controls: ['locale', 'customerStatus', 'promotionActive', 'itemCount'],
    sharedTemplate: 'Les Emails 1, 2 et 3 partagent actuellement le même template et le même objet.',
  },
  {
    id: 'abandoned_cart_2',
    name: 'Panier abandonné · Email 2',
    family: 'customer',
    description: 'Deuxième relance de la séquence panier.',
    timing: '2 jours après l’Email 1',
    source: 'emails/abandoned-cart/AbandonedCartEmail.tsx',
    controls: ['locale', 'customerStatus', 'promotionActive', 'itemCount'],
    sharedTemplate: 'Les Emails 1, 2 et 3 partagent actuellement le même template et le même objet.',
  },
  {
    id: 'abandoned_cart_3',
    name: 'Panier abandonné · Email 3',
    family: 'customer',
    description: 'Dernière relance de la séquence panier.',
    timing: '2 jours après l’Email 2',
    source: 'emails/abandoned-cart/AbandonedCartEmail.tsx',
    controls: ['locale', 'customerStatus', 'promotionActive', 'itemCount'],
    sharedTemplate: 'Les Emails 1, 2 et 3 partagent actuellement le même template et le même objet.',
  },
  {
    id: 'payment_help_1',
    name: 'Aide au paiement',
    family: 'customer',
    description: 'Message d’assistance lorsqu’une tentative de paiement n’aboutit pas.',
    timing: '1 heure après la tentative de paiement',
    source: 'emails/payment-help/render.ts',
    controls: ['locale'],
  },
  {
    id: 'admin_invite',
    name: 'Invitation admin',
    family: 'admin',
    description: 'Invitation d’un membre de l’équipe dans l’admin Palas.',
    timing: 'À la création ou au renvoi d’une invitation',
    source: 'emails/admin-invite/render.ts',
    controls: [],
  },
  {
    id: 'daily_reporting',
    name: 'Reporting quotidien',
    family: 'reporting',
    description: 'Rapport opérationnel quotidien envoyé à l’équipe Palas.',
    timing: 'Tous les jours à 03:00',
    source: 'utils/daily-reporting.ts',
    controls: ['reportStatus'],
  },
]
