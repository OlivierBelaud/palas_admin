import { describe, expect, it } from 'vitest'
import { renderEmailTemplatePreview } from '../src/emails/catalog'
import {
  EMAIL_TEMPLATE_CATALOG,
  type EmailTemplatePreviewInput,
  sameEmailPreviewScenario,
} from '../src/emails/catalog-contract'

describe('email template preview catalog', () => {
  it('lists every hard-coded application email', () => {
    expect(EMAIL_TEMPLATE_CATALOG.map((template) => template.id)).toEqual([
      'abandoned_cart_1',
      'abandoned_cart_2',
      'abandoned_cart_3',
      'payment_help_1',
      'admin_invite',
      'daily_reporting',
    ])
  })

  it('rejects stale preview data when any scenario control changes', () => {
    const scenario: EmailTemplatePreviewInput = {
      templateId: 'abandoned_cart_1',
      locale: 'fr',
      customerStatus: 'new',
      promotionActive: true,
      itemCount: 2,
      reportStatus: 'ready',
    }

    expect(sameEmailPreviewScenario(scenario, { ...scenario })).toBe(true)
    expect(sameEmailPreviewScenario(scenario, { ...scenario, locale: 'en' })).toBe(false)
    expect(sameEmailPreviewScenario(scenario, { ...scenario, templateId: 'abandoned_cart_2' })).toBe(false)
    expect(sameEmailPreviewScenario(scenario, { ...scenario, promotionActive: false })).toBe(false)
  })

  it('renders the selected locale and welcome promotion for a new customer', async () => {
    const preview = await renderEmailTemplatePreview({
      templateId: 'abandoned_cart_2',
      locale: 'en',
      customerStatus: 'new',
      promotionActive: true,
      itemCount: 2,
      reportStatus: 'ready',
    })

    expect(preview.subject).toBe('Make it yours today 🌸')
    expect(preview.html).toContain('PALAS-WELCOME-10')
    expect(preview.html).toContain('Your 10% welcome discount is still available on your basket.')
    expect(preview.html).toContain('2ad06794-ddad-4fe8-a9f8-770c54dcf786')
    expect(preview.html).not.toContain('santa-maria-necklace-red')
    expect(preview.html).toContain('Santa Maria - Necklace Red')
    expect(preview.appliedBranches).toContain('Welcome discount reminder shown')
  })

  it.each([
    ['abandoned_cart_1', 'fr'],
    ['abandoned_cart_1', 'en'],
    ['abandoned_cart_2', 'fr'],
    ['abandoned_cart_2', 'en'],
    ['abandoned_cart_3', 'fr'],
    ['abandoned_cart_3', 'en'],
  ] as const)('renders %s in %s with the correct customer-status offer', async (templateId, locale) => {
    const newCustomer = await renderEmailTemplatePreview({
      templateId,
      locale,
      customerStatus: 'new',
      promotionActive: true,
      itemCount: 1,
      reportStatus: 'ready',
    })
    const returningCustomer = await renderEmailTemplatePreview({
      templateId,
      locale,
      customerStatus: 'returning',
      promotionActive: true,
      itemCount: 1,
      reportStatus: 'ready',
    })

    expect(newCustomer.subject).toBeTruthy()
    expect(newCustomer.html).toContain('PALAS-WELCOME-10')
    expect(returningCustomer.subject).toBeTruthy()
    if (templateId === 'abandoned_cart_1') {
      expect(returningCustomer.html).not.toContain('PANIER10-PREVIEW')
    } else {
      expect(returningCustomer.html).toContain('PANIER10-PREVIEW')
    }
  })

  it('renders a distinct assistance design for Email 3 while keeping scenario controls', async () => {
    const preview = await renderEmailTemplatePreview({
      templateId: 'abandoned_cart_3',
      locale: 'fr',
      customerStatus: 'returning',
      promotionActive: true,
      itemCount: 2,
      reportStatus: 'ready',
    })

    expect(preview.subject).toBe('Un doute ? Une question ? Je suis là pour vous ❤️')
    expect(preview.text).toContain('Bonjour Camille,')
    expect(preview.html).toContain('d5b52b1f-3aa4-480c-9280-f8de3944b486')
    expect(preview.html).toContain('2982a0eb-5e22-4e4c-8bd2-da690775978a')
    expect(preview.html).not.toContain('PALAS-WELCOME-10')
    expect(preview.html).toContain('PANIER10-PREVIEW')
    expect(preview.html).toContain('Santa Maria - Necklace Red')
    expect(preview.appliedBranches).toContain('Abandoned-cart discount offer shown (simulation)')
  })

  it('does not offer the returning-customer recovery discount in Email 1', async () => {
    const preview = await renderEmailTemplatePreview({
      templateId: 'abandoned_cart_1',
      locale: 'fr',
      customerStatus: 'returning',
      promotionActive: true,
      itemCount: 1,
      reportStatus: 'ready',
    })

    expect(preview.html).not.toContain('PALAS-WELCOME-10')
    expect(preview.html).not.toContain('PANIER10-PREVIEW')
    expect(preview.appliedBranches).toContain('Abandoned-cart discount not offered in Email 1')
  })

  it('hides all discount codes when the promotion campaign is inactive', async () => {
    const preview = await renderEmailTemplatePreview({
      templateId: 'abandoned_cart_2',
      locale: 'fr',
      customerStatus: 'returning',
      promotionActive: false,
      itemCount: 2,
      reportStatus: 'ready',
    })

    expect(preview.html).not.toContain('PALAS-WELCOME-10')
    expect(preview.html).not.toContain('PANIER10-PREVIEW')
    expect(preview.appliedBranches).toContain('Promotion hidden: campaign inactive')
  })

  it('renders payment help in English without unrelated promotion copy', async () => {
    const preview = await renderEmailTemplatePreview({
      templateId: 'payment_help_1',
      locale: 'en',
      customerStatus: 'new',
      promotionActive: true,
      itemCount: 3,
      reportStatus: 'ready',
    })

    expect(preview.subject).toBe('Need help finalising your order?')
    expect(preview.text).toContain('Hello Camille,')
    expect(preview.text).toContain('You can also return to your cart here:')
    expect(preview.html).toContain('We noticed your order was not finalised')
    expect(preview.html).not.toContain('PALAS-WELCOME-10')
  })

  it('keeps the payment-help greeting in French for the French locale', async () => {
    const preview = await renderEmailTemplatePreview({
      templateId: 'payment_help_1',
      locale: 'fr',
      customerStatus: 'returning',
      promotionActive: false,
      itemCount: 1,
      reportStatus: 'ready',
    })

    expect(preview.subject).toBe('Besoin d’aide pour finaliser votre commande ?')
    expect(preview.text).toContain('Bonjour Camille,')
    expect(preview.html).toContain('Votre commande n’a pas été finalisée')
  })

  it('renders the admin invitation with a safe fake link', async () => {
    const preview = await renderEmailTemplatePreview({
      templateId: 'admin_invite',
      locale: 'fr',
      customerStatus: 'new',
      promotionActive: false,
      itemCount: 1,
      reportStatus: 'ready',
    })

    expect(preview.subject).toBe('Invitation Palas Admin')
    expect(preview.html).toContain("Accepter l'invitation")
    expect(preview.html).toContain('token=preview-token')
  })

  it('renders the partial daily-report branch with fake campaign data', async () => {
    const preview = await renderEmailTemplatePreview({
      templateId: 'daily_reporting',
      locale: 'fr',
      customerStatus: 'new',
      promotionActive: false,
      itemCount: 1,
      reportStatus: 'partial',
    })

    expect(preview.subject).toContain('[PARTIEL] Reporting Palas')
    expect(preview.html).toContain('Reporting quotidien Palas')
    expect(preview.html).toContain('Email 1')
  })
})
