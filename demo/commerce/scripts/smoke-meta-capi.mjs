#!/usr/bin/env node

import { createHash } from 'node:crypto'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function optional(name, fallback = null) {
  return process.env[name]?.trim() || fallback
}

function sha256(value) {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

const pixelId = required('META_PIXEL_ID')
const accessToken = required('META_ACCESS_TOKEN')
const testEventCode = optional('META_TEST_EVENT_CODE')
const apiVersion = optional('META_CAPI_API_VERSION', 'v25.0')
const endpoint = optional('META_CAPI_ENDPOINT', `https://graph.facebook.com/${apiVersion}`)

const eventId = `palas_meta_smoke_${Date.now()}`
const payload = {
  data: [
    {
      event_name: 'TestEvent',
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: 'https://fancypalas.com/',
      user_data: {
        client_ip_address: '254.254.254.254',
        client_user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:63.0) Gecko/20100101 Firefox/63.0',
        em: [sha256('meta-smoke-test@fancypalas.com')],
      },
    },
  ],
  ...(testEventCode ? { test_event_code: testEventCode } : {}),
}

const url = new URL(`${endpoint.replace(/\/$/, '')}/${pixelId}/events`)
url.searchParams.set('access_token', accessToken)

const res = await fetch(url.toString(), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
const text = await res.text().catch(() => '')
let body = null
try {
  body = text ? JSON.parse(text) : null
} catch {
  body = { text: text.slice(0, 500) }
}

const error = body?.error
const summary = {
  ok: res.ok,
  http_status: res.status,
  pixel_id: pixelId,
  test_event_code_present: Boolean(testEventCode),
  event_id: eventId,
  events_received: body?.events_received ?? null,
  fbtrace_id: body?.fbtrace_id ?? error?.fbtrace_id ?? null,
  error_code: error?.code ?? null,
  error_subcode: error?.error_subcode ?? null,
  error_message: error?.message ?? null,
}

console.log(JSON.stringify(summary, null, 2))
process.exit(res.ok && Number(body?.events_received ?? 0) >= 1 ? 0 : 1)
