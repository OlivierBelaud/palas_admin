import { refreshContactFromSources } from '../../modules/contact/refresh-contact'

export default defineCommand({
  name: 'refreshContact',
  description:
    'Refresh one Contact snapshot from canonical sources (Shopify, Klaviyo, PostHog) using email as the key.',
  input: z.object({
    email: z.string().email(),
    reason: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    dryRun: z.boolean().default(false),
  }),
  workflow: async (input, { step, log }) => {
    const svc = step.service as unknown as {
      contact: {
        list(filters: Record<string, unknown>, opts?: Record<string, unknown>): Promise<never[]>
        create(data: Record<string, unknown>): Promise<{ id: string }>
        update(id: string, data: Record<string, unknown>): Promise<unknown>
      }
    }
    const outcome = await refreshContactFromSources(input, svc.contact, log)
    log.info(
      `[refreshContact] email=${outcome.email} contact_id=${outcome.contact_id ?? 'null'} created=${outcome.created} changed=${outcome.changed_fields.join(',') || '-'} sources=${Object.entries(
        outcome.sources,
      )
        .filter(([, ok]) => ok)
        .map(([name]) => name)
        .join(',')}`,
    )
    return outcome
  },
})
