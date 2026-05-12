// Command: upsert a visitor-session row from a PostHog event.
//
// Called by both the live subscriber (posthog-cart-tracker.ts) and the
// cron rattrapage (sync-posthog-events.ts) for every event that carries
// a `distinct_id` AND a `$session_id`. Idempotent thanks to the
// per-session `seen_event_uuids` FIFO array.
//
// Workflow:
//   1. Look up existing visitor_session by (distinct_id, session_id).
//   2. If new session: lookup Contact by distinct_id → derive segment.
//   3. Call the pure planSessionUpsert(...) planner.
//   4. Apply via step.service.visitorSession.upsertWithReplace(...)
//      with conflict target ['distinct_id', 'session_id'].

import {
  type ExistingSession,
  type IdentityAtStart,
  planSessionUpsert,
  type SessionSegment,
} from '../../modules/visitor-session/upsert-session'

type SessionRow = ExistingSession & {
  // upsertWithReplace returns the full row — we type the runtime shape
  // so callers can read `.id` etc.
}

type ContactRow = {
  id: string
  distinct_id?: string | null
  first_order_at?: Date | string | null
}

type EntityCrud<Row> = {
  list: (filters: Record<string, unknown>) => Promise<Row[]>
  update: (id: string, data: Record<string, unknown>) => Promise<Row>
  upsertWithReplace?: (
    rows: Record<string, unknown>[],
    replaceFields?: string[],
    conflictTarget?: string[],
  ) => Promise<Record<string, unknown>[]>
}

export default defineCommand({
  name: 'upsertVisitorSessionFromEvent',
  description:
    'Upsert a visitor-session snapshot row from a PostHog event. Idempotent on (distinct_id, session_id, event_uuid).',
  input: z.object({
    distinct_id: z.string().min(1),
    session_id: z.string().min(1),
    event_uuid: z.string().nullable().optional(),
    event_name: z.string().min(1),
    occurred_at: z.string().datetime(),
    email_on_event: z.string().nullable().optional(),
    current_url: z.string().nullable().optional(),
    utm_source: z.string().nullable().optional(),
    utm_medium: z.string().nullable().optional(),
    utm_campaign: z.string().nullable().optional(),
    referring_domain: z.string().nullable().optional(),
  }),
  workflow: async (input, { step }) => {
    // step.service runtime exposes per-entity CRUD (visitorSession, contact).
    // Static type only knows about module names — same trick used in
    // ingest-cart-event.ts / sync-klaviyo-events.ts.
    const svc = step.service as unknown as {
      visitorSession: EntityCrud<SessionRow>
      contact: EntityCrud<ContactRow>
    }

    // ── 1. Lookup existing session by (distinct_id, session_id) ─────
    const existingRows = await svc.visitorSession.list({
      distinct_id: input.distinct_id,
      session_id: input.session_id,
    })
    if (existingRows.length > 1) {
      throw new MantaError(
        'INVALID_STATE',
        `Found ${existingRows.length} visitor_session rows for (${input.distinct_id}, ${input.session_id}); expected 0 or 1`,
      )
    }
    const existing: ExistingSession | undefined = existingRows[0]

    // ── 2. Resolve identity at session start (only on new sessions) ─
    let identityAtStart: IdentityAtStart
    if (existing) {
      // Re-use the frozen identity — we never re-classify a session.
      identityAtStart = {
        contact_id: existing.contact_id,
        email: existing.email_at_session_start,
        segment: existing.segment_at_session_start,
      }
    } else {
      const contacts = await svc.contact.list({ distinct_id: input.distinct_id })
      const contact = contacts[0]
      const occurredAt = new Date(input.occurred_at).getTime()
      let segment: SessionSegment = 'unknown'
      if (contact) {
        const firstOrderAt = contact.first_order_at ? new Date(contact.first_order_at).getTime() : null
        if (firstOrderAt != null && firstOrderAt < occurredAt) {
          segment = 'returning_customer'
        } else {
          segment = 'known_no_purchase'
        }
      }
      identityAtStart = {
        contact_id: contact?.id ?? null,
        email: null, // Contact email isn't read here — email_at_session_start comes from the event.
        segment,
      }
    }

    // ── 3. Plan the upsert via the pure helper ──────────────────────
    const intent = planSessionUpsert({
      event: {
        distinct_id: input.distinct_id,
        session_id: input.session_id,
        event_uuid: input.event_uuid ?? null,
        event_name: input.event_name,
        occurred_at: input.occurred_at,
        email_on_event: input.email_on_event ?? null,
        current_url: input.current_url ?? null,
        utm_source: input.utm_source ?? null,
        utm_medium: input.utm_medium ?? null,
        utm_campaign: input.utm_campaign ?? null,
        referring_domain: input.referring_domain ?? null,
      },
      existingSession: existing,
      identityAtStart,
    })

    // ── 4. Apply via upsertWithReplace (multi-column conflict target) ─
    if (!svc.visitorSession.upsertWithReplace) {
      throw new MantaError(
        'INVALID_STATE',
        'visitorSession.upsertWithReplace is not exposed — check entities/visitor-session/service.ts',
      )
    }
    await svc.visitorSession.upsertWithReplace(
      [intent.row as unknown as Record<string, unknown>],
      intent.replaceFields,
      [...intent.conflictTarget],
    )

    return { distinct_id: input.distinct_id, session_id: input.session_id, is_new: !existing }
  },
})
