// Public command — persist a cart-drawer email submission + dispatch
// Klaviyo subscribe and PostHog event in parallel.
//
// Lives at `src/commands/` (no context folder) → flat, not exposed via
// `/api/:context/command/:name`. Invoked manually from the public route
// `modules/cart-email-capture/api/e/route.ts` which handles HTTP shape
// and CORS.
//
// Why a command and not raw DB in the route: routes don't get
// `step.service` (they'd need direct adapter access), commands do. Keeping
// writes behind the service layer means the adapter wiring stays the
// framework's job, not ours.

import { sendKlaviyoEvent, subscribeKlaviyoProfile } from '../utils/klaviyo'
import { sendPosthogEvent } from '../utils/posthog-ingest'

const DISCOUNT_CODE = 'SURPRISE10'
const KLAVIYO_LIST_ID = 'SUtgMh' // "Newsletter"
const SOURCE = 'cart_drawer_surprise'
const EVENT_NAME = 'cart:email_form_submitted'

interface EmailCaptureRow {
  id: string
  email: string
  cart_token: string | null
  is_test: boolean
}

interface EntityCrud<Row> {
  create: (data: Record<string, unknown>) => Promise<Row>
  update: (id: string, data: Record<string, unknown>) => Promise<Row>
}

export default defineCommand({
  name: 'submitCartEmail',
  description:
    'Persist a cart-drawer "surprise" email submission and fan out to Klaviyo (subscribe + event) + PostHog (identify + event). Returns the discount code the theme should auto-apply.',
  input: z.object({
    email: z.string().email(),
    cart_token: z.string().nullable().optional(),
    market: z.string().max(8).nullable().optional(),
    posthog_distinct_id: z.string().max(128).nullable().optional(),
    is_test: z.boolean().default(false),
    user_agent: z.string().nullable().optional(),
    remote_ip: z.string().nullable().optional(),
  }),
  workflow: async (input, { step, log }) => {
    const email = input.email.toLowerCase()

    // 1. Persist. Service layer handles adapter wiring + schema validation.
    // The runtime Proxy resolves `emailCapture` to the auto-generated CRUD
    // even though it's not surfaced in MantaGeneratedAppModules yet.
    const svc = step.service as unknown as { emailCapture: EntityCrud<EmailCaptureRow> }
    const row = await svc.emailCapture.create({
      email,
      cart_token: input.cart_token ?? null,
      source: SOURCE,
      market: input.market ?? null,
      posthog_distinct_id: input.posthog_distinct_id ?? null,
      is_test: input.is_test,
      user_agent: input.user_agent ?? null,
      remote_ip: input.remote_ip ?? null,
    })
    log.info(`[submitCartEmail] captured id=${row.id} email=${email} test=${input.is_test}`)

    // 2. In test mode we stop here — no external noise (Klaviyo / PostHog).
    if (input.is_test) {
      return { id: row.id, discount_code: DISCOUNT_CODE }
    }

    // 3. Fan out. Three independent network calls, no ordering constraints.
    //    Each helper is already never-throw (returns { ok, status, error }).
    const [subRes, evtRes, phRes] = await Promise.allSettled([
      subscribeKlaviyoProfile({ email, listId: KLAVIYO_LIST_ID, customSource: SOURCE }),
      sendKlaviyoEvent({
        email,
        metric: EVENT_NAME,
        properties: {
          source: SOURCE,
          market: input.market ?? null,
          cart_token: input.cart_token ?? null,
          discount_code: DISCOUNT_CODE,
        },
        unique_id: row.id,
      }),
      sendPosthogEvent({
        event: EVENT_NAME,
        distinctId: input.posthog_distinct_id ?? email,
        email,
        ip: input.remote_ip ?? null,
        properties: {
          source: SOURCE,
          market: input.market ?? null,
          cart_token: input.cart_token ?? null,
          discount_code: DISCOUNT_CODE,
        },
      }),
    ])

    const klOk =
      (subRes.status === 'fulfilled' && subRes.value.ok) || (evtRes.status === 'fulfilled' && evtRes.value.ok)
    const phOk = phRes.status === 'fulfilled' && phRes.value.ok

    if (!klOk) log.warn(`[submitCartEmail] klaviyo dispatch failed for ${email}`)
    if (!phOk) log.warn(`[submitCartEmail] posthog dispatch failed for ${email}`)

    // 4. Record sync timestamps on the row so the admin list can show
    //    which captures reached Klaviyo/PostHog and which need retry.
    if (klOk || phOk) {
      const now = new Date()
      try {
        await svc.emailCapture.update(row.id, {
          klaviyo_synced_at: klOk ? now : null,
          posthog_synced_at: phOk ? now : null,
        })
      } catch (err) {
        log.warn(`[submitCartEmail] mark-synced failed: ${(err as Error).message}`)
      }
    }

    return { id: row.id, discount_code: DISCOUNT_CODE }
  },
})
