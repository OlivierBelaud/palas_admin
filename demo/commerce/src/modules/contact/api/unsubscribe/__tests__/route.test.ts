// NOTIF-UNSUB-01 — Route tests for /api/contact/unsubscribe.
//
// Stubs `req.app.commands.markContactUnsubscribed` so we test the route in
// isolation: token verification, idempotence guard, "no-leak" behaviour on
// invalid input, RFC 8058 one-click POST, and lang detection.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signUnsubscribeToken } from '../../../../../utils/unsubscribe-token'
import { GET, POST } from '../route'

interface CmdCall {
  email: string
}

function makeReq(opts: {
  method: 'GET' | 'POST'
  url: string
  headers?: Record<string, string>
  cmd?: (input: CmdCall) => Promise<unknown>
}): Request {
  const req = new Request(opts.url, {
    method: opts.method,
    headers: opts.headers,
  })
  Object.defineProperty(req, 'app', {
    value: { commands: { markContactUnsubscribed: opts.cmd } },
    enumerable: true,
    configurable: true,
  })
  return req
}

describe('GET /api/contact/unsubscribe', () => {
  let cmdCalls: CmdCall[]
  let cmd: (input: CmdCall) => Promise<unknown>

  beforeEach(() => {
    cmdCalls = []
    cmd = vi.fn(async (input: CmdCall) => {
      cmdCalls.push(input)
      return { found: true, alreadyOptedOut: false }
    })
  })

  it('returns 200 HTML and calls the command when token is valid', async () => {
    const token = signUnsubscribeToken('jane@example.com')
    const req = makeReq({
      method: 'GET',
      url: `https://admin.fancypalas.com/api/contact/unsubscribe?t=${encodeURIComponent(token)}`,
      cmd,
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('no-store')

    const html = await res.text()
    expect(html).toContain('Vous êtes désinscrit')
    expect(html).toContain('https://fancypalas.com')

    expect(cmdCalls).toHaveLength(1)
    expect(cmdCalls[0].email).toBe('jane@example.com')
  })

  it('returns 200 HTML even when token is invalid (no leak)', async () => {
    const req = makeReq({
      method: 'GET',
      url: 'https://admin.fancypalas.com/api/contact/unsubscribe?t=garbage',
      cmd,
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Vous êtes désinscrit')
    expect(cmdCalls).toHaveLength(0) // command NOT called for invalid token
  })

  it('returns 200 HTML when ?t= is missing entirely (no leak)', async () => {
    const req = makeReq({
      method: 'GET',
      url: 'https://admin.fancypalas.com/api/contact/unsubscribe',
      cmd,
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Vous êtes désinscrit')
    expect(cmdCalls).toHaveLength(0)
  })

  it('renders the EN page when ?lang=en', async () => {
    const token = signUnsubscribeToken('bob@example.com')
    const req = makeReq({
      method: 'GET',
      url: `https://admin.fancypalas.com/api/contact/unsubscribe?t=${encodeURIComponent(token)}&lang=en`,
      cmd,
    })

    const html = await (await GET(req)).text()
    expect(html).toContain('You have been unsubscribed')
    expect(html).not.toContain('Vous êtes désinscrit')
    expect(html).toContain('Back to the shop')
  })

  it('renders the EN page when Accept-Language starts with en', async () => {
    const token = signUnsubscribeToken('bob@example.com')
    const req = makeReq({
      method: 'GET',
      url: `https://admin.fancypalas.com/api/contact/unsubscribe?t=${encodeURIComponent(token)}`,
      headers: { 'accept-language': 'en-US,en;q=0.9,fr;q=0.8' },
      cmd,
    })

    const html = await (await GET(req)).text()
    expect(html).toContain('You have been unsubscribed')
  })

  it('still returns 200 when the command throws (degrade gracefully)', async () => {
    const failingCmd = vi.fn(async () => {
      throw new Error('DB exploded')
    })
    const token = signUnsubscribeToken('jane@example.com')
    const req = makeReq({
      method: 'GET',
      url: `https://admin.fancypalas.com/api/contact/unsubscribe?t=${encodeURIComponent(token)}`,
      cmd: failingCmd,
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(failingCmd).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/contact/unsubscribe (RFC 8058 one-click)', () => {
  it('returns 204 and calls the command when token is valid', async () => {
    const calls: CmdCall[] = []
    const cmd = vi.fn(async (input: CmdCall) => {
      calls.push(input)
      return { found: true, alreadyOptedOut: false }
    })
    const token = signUnsubscribeToken('jane@example.com')
    const req = makeReq({
      method: 'POST',
      url: `https://admin.fancypalas.com/api/contact/unsubscribe?t=${encodeURIComponent(token)}`,
      cmd,
    })

    const res = await POST(req)
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(calls).toHaveLength(1)
    expect(calls[0].email).toBe('jane@example.com')
  })

  it('returns 204 even when token is invalid (no leak)', async () => {
    const cmd = vi.fn()
    const req = makeReq({
      method: 'POST',
      url: 'https://admin.fancypalas.com/api/contact/unsubscribe?t=bad',
      cmd,
    })

    const res = await POST(req)
    expect(res.status).toBe(204)
    expect(cmd).not.toHaveBeenCalled()
  })

  it('idempotence: calling twice still succeeds, command is called twice (handler-level idempotence)', async () => {
    // Idempotence is enforced INSIDE the command (it skips the UPDATE when
    // already opted-out). At the route level we just verify both calls
    // succeed without error and reach the command.
    const calls: CmdCall[] = []
    const cmd = vi.fn(async (input: CmdCall) => {
      calls.push(input)
      // First call: not yet opted-out. Second call: already opted-out (no-op).
      return { found: true, alreadyOptedOut: calls.length > 1 }
    })
    const token = signUnsubscribeToken('jane@example.com')
    const url = `https://admin.fancypalas.com/api/contact/unsubscribe?t=${encodeURIComponent(token)}`

    const res1 = await POST(makeReq({ method: 'POST', url, cmd }))
    const res2 = await POST(makeReq({ method: 'POST', url, cmd }))

    expect(res1.status).toBe(204)
    expect(res2.status).toBe(204)
    expect(calls).toHaveLength(2)
    expect(calls[0].email).toBe('jane@example.com')
    expect(calls[1].email).toBe('jane@example.com')
  })
})
