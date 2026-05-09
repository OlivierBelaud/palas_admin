// NOTIF-UNSUB-01 — Marketing email unsubscribe endpoint.
//
// Two methods, same business logic:
//   GET  /api/contact/unsubscribe?t=<token>  → user-clicked link, returns HTML page
//   POST /api/contact/unsubscribe?t=<token>  → RFC 8058 one-click (Gmail/Outlook),
//                                              returns 204
//
// The token is a HMAC-signed payload carrying the lowercased email; see
// `src/utils/unsubscribe-token.ts`. No TTL on the token (emails may be opened
// months after dispatch).
//
// On invalid token / unknown email we still render the success page — we do
// not leak email existence. A `warn` is logged server-side for debugging.

import { verifyUnsubscribeToken } from '../../../../utils/unsubscribe-token'

interface MarkContactUnsubscribedInput {
  email: string
}

type MarkContactUnsubscribedFn = (
  input: MarkContactUnsubscribedInput,
  opts?: Record<string, unknown>,
) => Promise<unknown>

interface MantaApp {
  commands?: Record<string, MarkContactUnsubscribedFn | undefined>
}

function getApp(req: Request): MantaApp | null {
  const mantaReq = req as Request & { app?: MantaApp }
  return mantaReq.app ?? null
}

// ── Lang detection ──────────────────────────────────────────────────

type Lang = 'fr' | 'en'

function pickLang(req: Request, url: URL): Lang {
  const queryLang = (url.searchParams.get('lang') ?? '').toLowerCase()
  if (queryLang === 'en') return 'en'
  if (queryLang === 'fr') return 'fr'

  const accept = (req.headers.get('accept-language') ?? '').toLowerCase()
  if (!accept) return 'fr'
  // Naive: pick the first language tag, ignore q-values. Good enough for
  // a 2-lang choice; falls back to FR on any ambiguity.
  const first = accept.split(',')[0]?.trim() ?? ''
  if (first.startsWith('en')) return 'en'
  return 'fr'
}

// ── HTML rendering ──────────────────────────────────────────────────

const COPY: Record<Lang, { title: string; body: string; cta: string; footer: string }> = {
  fr: {
    title: 'Vous êtes désinscrit',
    body: "Vous ne recevrez plus d'emails marketing de la part de Fancy Palas. Si c'est une erreur, écrivez-nous : nous vous remettrons en liste avec plaisir.",
    cta: 'Retour à la boutique',
    footer: 'Fancy Palas',
  },
  en: {
    title: 'You have been unsubscribed',
    body: "You will no longer receive marketing emails from Fancy Palas. If this was a mistake, just email us — we'll add you back gladly.",
    cta: 'Back to the shop',
    footer: 'Fancy Palas',
  },
}

const SHOP_URL = 'https://fancypalas.com'

function renderPage(lang: Lang): string {
  const c = COPY[lang]
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${c.title} — Fancy Palas</title>
  <style>
    html, body { margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #fafaf7;
      color: #2a2a28;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      box-sizing: border-box;
    }
    .card {
      background: #fff;
      border: 1px solid #ece9e1;
      border-radius: 12px;
      padding: 40px 32px;
      max-width: 600px;
      width: 100%;
      text-align: center;
      box-shadow: 0 1px 2px rgba(0,0,0,0.03);
    }
    h1 { font-size: 22px; font-weight: 600; margin: 0 0 16px; letter-spacing: -0.01em; }
    p { font-size: 15px; line-height: 1.55; color: #555; margin: 0 0 24px; }
    a.cta {
      display: inline-block;
      background: #1a1a1a;
      color: #fff;
      text-decoration: none;
      padding: 12px 28px;
      border-radius: 8px;
      font-size: 14px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .footer { margin-top: 32px; font-size: 12px; color: #999; letter-spacing: 0.04em; text-transform: uppercase; }
  </style>
</head>
<body>
  <main class="card">
    <h1>${c.title}</h1>
    <p>${c.body}</p>
    <a class="cta" href="${SHOP_URL}">${c.cta}</a>
    <div class="footer">${c.footer}</div>
  </main>
</body>
</html>
`
}

// ── Shared business logic ───────────────────────────────────────────

async function processUnsubscribe(req: Request, token: string | null): Promise<void> {
  if (!token) {
    console.warn('[unsubscribe] missing token query parameter')
    return
  }

  const verified = verifyUnsubscribeToken(token)
  if (!verified) {
    console.warn('[unsubscribe] invalid or unverifiable token')
    return
  }

  const app = getApp(req)
  const cmd = app?.commands?.markContactUnsubscribed
  if (!cmd) {
    console.warn('[unsubscribe] markContactUnsubscribed command not registered')
    return
  }

  try {
    await cmd({ email: verified.email })
  } catch (err) {
    console.warn(`[unsubscribe] command failed: ${(err as Error).message.slice(0, 200)}`)
  }
}

// ── Handlers ────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get('t')
  const lang = pickLang(req, url)

  await processUnsubscribe(req, token)

  return new Response(renderPage(lang), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get('t')

  await processUnsubscribe(req, token)

  // RFC 8058 one-click: 200/204 with empty body. Pick 204 for clarity.
  return new Response(null, {
    status: 204,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
