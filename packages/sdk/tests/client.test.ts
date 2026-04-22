// Unit tests for MantaClient — workflow run + command envelope handling.
// See WORKFLOW_PROGRESS.md §6.1 (RunResult) and §6.5 (workflow HTTP routes).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MantaClient, MantaSDKError } from '../src/client'

function mockResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

describe('MantaClient — runCommand envelope handling', () => {
  let client: MantaClient
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    client = new MantaClient({ context: 'admin', baseUrl: 'http://host', getToken: () => null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('W-SDK-C-01: succeeded inline envelope returns { status: succeeded, result, runId }', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ data: { status: 'succeeded', result: { id: 'p-1' }, runId: 'run-1' } }),
    )
    const res = await client.runCommand('create-product', { title: 'A' })
    expect(res).toEqual({ status: 'succeeded', result: { id: 'p-1' }, runId: 'run-1' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://host/api/admin/command/create-product')
    expect((init as RequestInit).method).toBe('POST')
  })

  it('W-SDK-C-02: running envelope returns { status: running, runId }', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(
        { data: { runId: 'run-42', status: 'running', href: '/api/admin/_workflow/run-42' } },
        { status: 202 },
      ),
    )
    const res = await client.runCommand('import-products', { file: 'x' })
    expect(res).toEqual({ status: 'running', runId: 'run-42' })
  })

  it('W-SDK-C-03: HTTP failure returns { status: failed, error: MantaSDKError }', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ type: 'INVALID_DATA', message: 'bad payload' }, { status: 400 }))
    const res = await client.runCommand('create-product', {})
    expect(res.status).toBe('failed')
    if (res.status === 'failed') {
      expect(res.error).toBeInstanceOf(MantaSDKError)
      expect(res.error.type).toBe('INVALID_DATA')
      expect(res.error.status).toBe(400)
      expect(res.error.message).toBe('bad payload')
    }
  })

  it('W-SDK-C-04: legacy unwrapped shape (data: bareResult) is treated as succeeded', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ data: { id: 'p-1', title: 'A' } }))
    const res = await client.runCommand('create-product', {})
    expect(res).toEqual({ status: 'succeeded', result: { id: 'p-1', title: 'A' }, runId: undefined })
  })
})

describe('MantaClient — command() back-compat', () => {
  let client: MantaClient
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    client = new MantaClient({ context: 'admin', baseUrl: '', getToken: () => null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('W-SDK-C-05: inline success — returns the bare result', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ data: { status: 'succeeded', result: { id: 'p-1' }, runId: 'r' } }))
    const out = await client.command<unknown, { id: string }>('create-product', {})
    expect(out).toEqual({ id: 'p-1' })
  })

  it('W-SDK-C-06: inline failure — throws MantaSDKError', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ type: 'INVALID_DATA', message: 'bad' }, { status: 400 }))
    await expect(client.command('create-product', {})).rejects.toBeInstanceOf(MantaSDKError)
  })

  it('W-SDK-C-07: async response — returns undefined (caller should use runCommand)', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(
        { data: { runId: 'run-42', status: 'running', href: '/api/admin/_workflow/run-42' } },
        { status: 202 },
      ),
    )
    const out = await client.command('import-products', {})
    expect(out).toBeUndefined()
  })
})

describe('MantaClient — workflow HTTP routes', () => {
  let client: MantaClient
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    client = new MantaClient({ context: 'admin', baseUrl: 'http://host', getToken: () => 'tok' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('W-SDK-C-08: getWorkflowRun GETs /api/admin/_workflow/:id and returns body.data', async () => {
    const snapshot = {
      id: 'run-1',
      command_name: 'import',
      status: 'running',
      steps: [{ name: 's1', status: 'running' }],
      inFlightProgress: { stepName: 's1', current: 3, total: 10, at: 123 },
    }
    fetchMock.mockResolvedValueOnce(mockResponse({ data: snapshot }))
    const out = await client.getWorkflowRun('run-1')
    expect(out).toEqual(snapshot)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://host/api/admin/_workflow/run-1')
    expect((init as RequestInit).method).toBe('GET')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
  })

  it('W-SDK-C-09: getWorkflowRun throws MantaSDKError on 404', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ type: 'NOT_FOUND', message: 'nope' }, { status: 404 }))
    await expect(client.getWorkflowRun('missing')).rejects.toMatchObject({
      type: 'NOT_FOUND',
      status: 404,
    })
  })

  it('W-SDK-C-10: cancelWorkflowRun DELETEs /api/admin/_workflow/:id', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ data: { status: 'cancel_requested', runId: 'run-1' } }))
    await client.cancelWorkflowRun('run-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://host/api/admin/_workflow/run-1')
    expect((init as RequestInit).method).toBe('DELETE')
  })

  it('W-SDK-C-11: cancelWorkflowRun throws MantaSDKError on server error', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ type: 'UNEXPECTED_STATE', message: 'boom' }, { status: 500 }))
    await expect(client.cancelWorkflowRun('run-1')).rejects.toMatchObject({
      type: 'UNEXPECTED_STATE',
      status: 500,
    })
  })
})
