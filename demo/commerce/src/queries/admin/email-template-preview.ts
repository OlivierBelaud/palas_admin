import { renderEmailTemplatePreview } from '../../emails/catalog'
import { EMAIL_TEMPLATE_IDS, type EmailTemplatePreviewInput } from '../../emails/catalog-contract'

export default defineQuery({
  name: 'email-template-preview',
  description: 'Render a safe fake-data preview of every hard-coded Palas application email.',
  input: z.object({
    templateId: z.enum(EMAIL_TEMPLATE_IDS),
    locale: z.enum(['fr', 'en']).default('fr'),
    customerStatus: z.enum(['new', 'returning']).default('new'),
    promotionActive: z.boolean().default(true),
    itemCount: z.number().int().min(1).max(4).default(2),
    reportStatus: z.enum(['ready', 'partial']).default('ready'),
  }),
  handler: async (input) => {
    const scenario = input as EmailTemplatePreviewInput
    return {
      scenario,
      preview: await renderEmailTemplatePreview(scenario),
    }
  },
})
