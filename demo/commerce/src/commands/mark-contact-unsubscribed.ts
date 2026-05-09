// Public command — flip the marketing opt-out flag on a Contact, looked up
// by lowercased email. Idempotent: re-running on an already-opted-out contact
// is a no-op (we don't overwrite the existing timestamp).
//
// Lives at `src/commands/` (no context folder) → not auto-exposed via
// `/api/:context/command/:name`. Invoked from the public route
// `modules/contact/api/unsubscribe/route.ts` (RFC 8058 one-click).
//
// Why a command and not raw DB in the route: routes don't get
// `step.service` (they'd need direct adapter access), commands do. Keeping
// writes behind the service layer means the adapter wiring stays the
// framework's job, not ours.

interface ContactRow {
  id: string
  email: string
  email_marketing_opt_out_at: Date | string | null
}

interface ContactCrud {
  listContacts: (filters: Record<string, unknown>) => Promise<ContactRow[]>
  updateContacts: (
    data: (Partial<ContactRow> & { id: string }) | (Partial<ContactRow> & { id: string })[],
  ) => Promise<ContactRow | ContactRow[]>
}

export interface MarkContactUnsubscribedResult {
  found: boolean
  alreadyOptedOut: boolean
  contactId?: string
}

export default defineCommand({
  name: 'markContactUnsubscribed',
  description: 'Set Contact.email_marketing_opt_out_at = now() for the given email (idempotent).',
  input: z.object({
    email: z.string(),
  }),
  workflow: async (input, { step, log }) => {
    return await step.action('mark-contact-unsubscribed', {
      invoke: async (_: unknown): Promise<MarkContactUnsubscribedResult> => {
        const email = input.email.trim().toLowerCase()
        if (!email) {
          throw new MantaError('INVALID_DATA', 'email is required')
        }

        const svc = step.service as unknown as { contact: ContactCrud }
        const rows = await svc.contact.listContacts({ email })
        const contact = rows[0]
        if (!contact) {
          // Not a leak — caller (the unsubscribe route) intentionally hides
          // existence from the end-user. Just log and report.
          log.warn(`[markContactUnsubscribed] no contact for email=${email}`)
          return { found: false, alreadyOptedOut: false }
        }

        if (contact.email_marketing_opt_out_at) {
          return { found: true, alreadyOptedOut: true, contactId: contact.id }
        }

        await svc.contact.updateContacts({ id: contact.id, email_marketing_opt_out_at: new Date() })
        log.info(`[markContactUnsubscribed] opted out contact_id=${contact.id} email=${email}`)
        return { found: true, alreadyOptedOut: false, contactId: contact.id }
      },
      compensate: async (_out, _ctx) => {
        // The opt-out is a user-driven RGPD action — we never silently
        // re-opt-in even if the workflow rolls back further upstream.
        log.warn('[markContactUnsubscribed] non-compensable: opt-out persists')
      },
    })({})
  },
})
