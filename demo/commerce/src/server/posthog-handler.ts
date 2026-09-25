import { defineEventHandler, getRequestHeaders, getRequestURL, readRawBody } from '@mantajs/adapter-h3'
import { getMantaApp } from '../../.manta/server/manta-bootstrap.js'
import { posthogWithVisitorContext } from './posthog-visitor-context'

// Explicit Nitro POST route: beta.12's production manifest does not register
// application src/api overrides. GET/OPTIONS keep the existing Manta routes.
export default defineEventHandler(async (event) => {
  const app = await getMantaApp()
  const body = await readRawBody(event, false)
  const request = new Request(getRequestURL(event), {
    method: 'POST',
    headers: getRequestHeaders(event),
    body: body as BodyInit | undefined,
  })
  return posthogWithVisitorContext(request, app)
})
